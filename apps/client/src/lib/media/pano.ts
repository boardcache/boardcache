import type { ImageItem } from '@boardcache/schema';

/**
 * 360° equirectangular panorama support: detection + a dependency-free
 * WebGL renderer (a fullscreen quad whose fragment shader casts a ray per
 * pixel and samples the equirect texture — no sphere mesh, no library).
 * Shared by the canvas item and the lightbox stage; viewer-bundle safe.
 */

/** Effective pano-ness: explicit override wins, else 2:1 equirect heuristic. */
export function isPanoImage(item: ImageItem): boolean {
  if (item.pano !== undefined) return item.pano;
  const ratio = item.naturalWidth / Math.max(1, item.naturalHeight);
  return Math.abs(ratio - 2) < 0.04 && item.naturalWidth >= 3000;
}

/** Aspect alone SUGGESTS an equirect pano — gates whether the context menu
 *  offers the 360° toggle at all (a square photo never sees it). */
export function panoCandidate(item: ImageItem): boolean {
  const ratio = item.naturalWidth / Math.max(1, item.naturalHeight);
  return Math.abs(ratio - 2) < 0.15;
}

/** Import-time sniff: GPano XMP marks true 360 photos regardless of size. */
export async function sniffPanoXmp(blob: Blob): Promise<boolean> {
  if (blob.type === 'image/svg+xml' || blob.type === 'image/gif') return false;
  try {
    const head = await blob.slice(0, 131072).text();
    return head.includes('GPano:') || head.includes('equirectangular');
  } catch {
    return false;
  }
}

const VERT = `attribute vec2 p;varying vec2 ndc;void main(){ndc=p;gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision highp float;
varying vec2 ndc;
uniform sampler2D tex;
uniform float yaw;   /* radians */
uniform float pitch; /* radians */
uniform float fovY;  /* radians */
uniform float aspect;
void main(){
  float t = tan(fovY * 0.5);
  vec3 dir = normalize(vec3(ndc.x * t * aspect, ndc.y * t, -1.0));
  /* pitch about X, then yaw about Y */
  float cp = cos(pitch), sp = sin(pitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float cy = cos(yaw), sy = sin(yaw);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);
  float u = atan(dir.x, -dir.z) / 6.2831853 + 0.5;
  float v = acos(clamp(dir.y, -1.0, 1.0)) / 3.14159265;
  gl_FragColor = texture2D(tex, vec2(u, v));
}`;

export interface PanoState {
  yaw: number;
  pitch: number;
  fov: number;
}

export class PanoRenderer {
  private gl: WebGLRenderingContext;
  private uni: {
    yaw: WebGLUniformLocation;
    pitch: WebGLUniformLocation;
    fovY: WebGLUniformLocation;
    aspect: WebGLUniformLocation;
  };
  private ready = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl =
      (canvas.getContext('webgl2') as WebGLRenderingContext | null) ?? canvas.getContext('webgl');
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uni = {
      yaw: gl.getUniformLocation(prog, 'yaw')!,
      pitch: gl.getUniformLocation(prog, 'pitch')!,
      fovY: gl.getUniformLocation(prog, 'fovY')!,
      aspect: gl.getUniformLocation(prog, 'aspect')!,
    };
  }

  /** Upload the equirect image (downscaled to the GPU's texture limit). */
  async load(url: string): Promise<void> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('pano image failed to load'));
      img.src = url;
    });
    const gl = this.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let source: TexImageSource = img;
    if (img.naturalWidth > max || img.naturalHeight > max) {
      const scale = max / Math.max(img.naturalWidth, img.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * scale);
      cv.height = Math.round(img.naturalHeight * scale);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      source = cv;
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // WebGL2 allows REPEAT on NPOT (seamless wrap); WebGL1 falls back to
    // clamp — a hairline seam at the wrap point, correct everywhere else.
    const isGl2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const wrap = isGl2 ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.ready = true;
  }

  draw(state: PanoState): void {
    if (!this.ready) return;
    const gl = this.gl;
    const w = this.canvas.width;
    const h = Math.max(1, this.canvas.height);
    gl.viewport(0, 0, w, h);
    gl.uniform1f(this.uni.yaw, state.yaw);
    gl.uniform1f(this.uni.pitch, state.pitch);
    gl.uniform1f(this.uni.fovY, (state.fov * Math.PI) / 180);
    gl.uniform1f(this.uni.aspect, w / h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy(): void {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
