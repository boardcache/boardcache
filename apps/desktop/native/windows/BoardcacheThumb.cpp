// boardCache thumbnail provider for Windows Explorer.
//
// An IThumbnailProvider that reads `thumbnail.png` out of a `.boardcache`
// zip (first entry, stored) and decodes it with WIC. No zip library, no
// inflate. Registered per file extension by the installer (installer.nsh)
// under HKCR\.boardcache\ShellEx\{E357FCCD-A995-4576-B01F-234630154E96}.
//
// Build: see CMakeLists.txt (MSVC, x64). Links shlwapi, windowscodecs, ole32.

#include <windows.h>
#include <shlwapi.h>
#include <shobjidl.h>
#include <thumbcache.h>
#include <wincodec.h>
#include <new>
#include <string>
#include <vector>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")

// {B0A7D1C2-5F3E-4C8A-9D21-6E4F2A7B3C01}
static const CLSID CLSID_BoardcacheThumb = {
    0xb0a7d1c2, 0x5f3e, 0x4c8a, {0x9d, 0x21, 0x6e, 0x4f, 0x2a, 0x7b, 0x3c, 0x01}};
static const wchar_t* kClsidText = L"{B0A7D1C2-5F3E-4C8A-9D21-6E4F2A7B3C01}";
static const wchar_t* kThumbHandler = L"{E357FCCD-A995-4576-B01F-234630154E96}";

static long g_objects = 0;
static HMODULE g_module = nullptr;

// ---------------------------------------------------------------- zip ---

namespace zip {
const uint32_t kLocal = 0x04034b50, kCentral = 0x02014b50, kEocd = 0x06054b50;
const size_t kMaxPng = 8u * 1024 * 1024;
const char* kName = "thumbnail.png";

static bool u16(const std::vector<uint8_t>& d, size_t at, uint32_t& out) {
  if (at + 2 > d.size()) return false;
  out = d[at] | (d[at + 1] << 8);
  return true;
}
static bool u32(const std::vector<uint8_t>& d, size_t at, uint32_t& out) {
  if (at + 4 > d.size()) return false;
  out = d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | ((uint32_t)d[at + 3] << 24);
  return true;
}
static bool nameIs(const std::vector<uint8_t>& d, size_t at, uint32_t len, const char* want) {
  size_t n = strlen(want);
  if (len != n || at + n > d.size()) return false;
  return memcmp(&d[at], want, n) == 0;
}

// Local header: sig(4) ver(2) flag(2) method(2) time(2) date(2) crc(4)
// csize(4) usize(4) nameLen(2) extraLen(2) name extra data.
static bool stored(const std::vector<uint8_t>& d, size_t off, uint32_t knownSize, bool haveKnown,
                   std::vector<uint8_t>& png) {
  uint32_t sig, flag, method, csize, nameLen, extraLen;
  if (!u32(d, off, sig) || sig != kLocal) return false;
  if (!u16(d, off + 6, flag) || !u16(d, off + 8, method) || !u32(d, off + 18, csize) ||
      !u16(d, off + 26, nameLen) || !u16(d, off + 28, extraLen))
    return false;
  if (!nameIs(d, off + 30, nameLen, kName) || method != 0) return false;
  uint32_t size;
  if (flag & 0x8) {  // data descriptor: sizes only in the central directory
    if (!haveKnown) return false;
    size = knownSize;
  } else {
    size = csize;
  }
  if (size == 0 || size > kMaxPng) return false;
  size_t start = off + 30 + nameLen + extraLen;
  if (start + size > d.size()) return false;
  png.assign(d.begin() + start, d.begin() + start + size);
  return true;
}

static bool fromCentral(const std::vector<uint8_t>& d, std::vector<uint8_t>& png) {
  if (d.size() < 22) return false;
  size_t tail = d.size() > 65557 ? d.size() - 65557 : 0;
  size_t eocd = SIZE_MAX;
  for (size_t i = d.size() - 22; i + 1 > tail; --i) {
    uint32_t sig;
    if (u32(d, i, sig) && sig == kEocd) { eocd = i; break; }
    if (i == 0) break;
  }
  if (eocd == SIZE_MAX) return false;
  uint32_t count, cd;
  if (!u16(d, eocd + 10, count) || !u32(d, eocd + 16, cd)) return false;
  size_t p = cd;
  for (uint32_t k = 0; k < count && k < 10000; ++k) {
    uint32_t sig, method, csize, nameLen, extraLen, commentLen, local;
    if (!u32(d, p, sig) || sig != kCentral) return false;
    if (!u16(d, p + 10, method) || !u32(d, p + 20, csize) || !u16(d, p + 28, nameLen) ||
        !u16(d, p + 30, extraLen) || !u16(d, p + 32, commentLen) || !u32(d, p + 42, local))
      return false;
    if (nameIs(d, p + 46, nameLen, kName)) {
      if (method != 0) return false;
      return stored(d, local, csize, true, png);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return false;
}

static bool thumbnail(const std::vector<uint8_t>& d, std::vector<uint8_t>& png) {
  if (d.size() < 30) return false;
  if (stored(d, 0, 0, false, png)) return true;
  return fromCentral(d, png);
}
}  // namespace zip

// ---------------------------------------------------------- provider ---

class BoardcacheThumb : public IThumbnailProvider, public IInitializeWithStream {
 public:
  BoardcacheThumb() : refs_(1) { InterlockedIncrement(&g_objects); }

  // IUnknown
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    static const QITAB qit[] = {
        QITABENT(BoardcacheThumb, IThumbnailProvider),
        QITABENT(BoardcacheThumb, IInitializeWithStream),
        {0},
    };
    return QISearch(this, qit, riid, ppv);
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs_); }
  IFACEMETHODIMP_(ULONG) Release() override {
    ULONG n = InterlockedDecrement(&refs_);
    if (n == 0) delete this;
    return n;
  }

  // IInitializeWithStream: Explorer hands us the file as a stream (works
  // for files inside other containers too, and never gives us a path).
  IFACEMETHODIMP Initialize(IStream* stream, DWORD) override {
    if (!stream) return E_POINTER;
    STATSTG st = {};
    if (FAILED(stream->Stat(&st, STATFLAG_NONAME))) return E_FAIL;
    if (st.cbSize.QuadPart > 2ull * 1024 * 1024 * 1024) return E_FAIL;
    bytes_.resize((size_t)st.cbSize.QuadPart);
    LARGE_INTEGER zero = {};
    stream->Seek(zero, STREAM_SEEK_SET, nullptr);
    size_t got = 0;
    while (got < bytes_.size()) {
      ULONG n = 0;
      DWORD want = (DWORD)min((size_t)(1u << 20), bytes_.size() - got);
      HRESULT hr = stream->Read(bytes_.data() + got, want, &n);
      if (FAILED(hr) || n == 0) break;
      got += n;
    }
    bytes_.resize(got);
    return S_OK;
  }

  // IThumbnailProvider
  IFACEMETHODIMP GetThumbnail(UINT cx, HBITMAP* phbmp, WTS_ALPHATYPE* pdwAlpha) override {
    *phbmp = nullptr;
    *pdwAlpha = WTSAT_ARGB;
    std::vector<uint8_t> png;
    if (!zip::thumbnail(bytes_, png)) return E_FAIL;
    return decode(png, cx, phbmp);
  }

 private:
  ~BoardcacheThumb() { InterlockedDecrement(&g_objects); }

  // PNG → 32-bit premultiplied BGRA DIB, scaled to fit cx×cx.
  static HRESULT decode(const std::vector<uint8_t>& png, UINT cx, HBITMAP* out) {
    IWICImagingFactory* factory = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(&factory));
    if (FAILED(hr)) return hr;
    IWICStream* stream = nullptr;
    IWICBitmapDecoder* decoder = nullptr;
    IWICBitmapFrameDecode* frame = nullptr;
    IWICBitmapScaler* scaler = nullptr;
    IWICFormatConverter* conv = nullptr;
    hr = factory->CreateStream(&stream);
    if (SUCCEEDED(hr)) hr = stream->InitializeFromMemory((BYTE*)png.data(), (DWORD)png.size());
    if (SUCCEEDED(hr))
      hr = factory->CreateDecoderFromStream(stream, nullptr, WICDecodeMetadataCacheOnDemand, &decoder);
    if (SUCCEEDED(hr)) hr = decoder->GetFrame(0, &frame);
    UINT w = 0, h = 0;
    if (SUCCEEDED(hr)) hr = frame->GetSize(&w, &h);
    UINT tw = w, th = h;
    if (SUCCEEDED(hr) && (w > cx || h > cx)) {
      if (w >= h) { tw = cx; th = max(1u, (UINT)((unsigned long long)h * cx / w)); }
      else        { th = cx; tw = max(1u, (UINT)((unsigned long long)w * cx / h)); }
    }
    if (SUCCEEDED(hr)) hr = factory->CreateBitmapScaler(&scaler);
    if (SUCCEEDED(hr)) hr = scaler->Initialize(frame, tw, th, WICBitmapInterpolationModeFant);
    if (SUCCEEDED(hr)) hr = factory->CreateFormatConverter(&conv);
    if (SUCCEEDED(hr))
      hr = conv->Initialize(scaler, GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, nullptr,
                            0.0, WICBitmapPaletteTypeCustom);
    if (SUCCEEDED(hr)) {
      BITMAPINFO bi = {};
      bi.bmiHeader.biSize = sizeof(bi.bmiHeader);
      bi.bmiHeader.biWidth = (LONG)tw;
      bi.bmiHeader.biHeight = -(LONG)th;  // top-down
      bi.bmiHeader.biPlanes = 1;
      bi.bmiHeader.biBitCount = 32;
      bi.bmiHeader.biCompression = BI_RGB;
      void* bits = nullptr;
      HBITMAP bmp = CreateDIBSection(nullptr, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
      if (!bmp) hr = E_OUTOFMEMORY;
      else {
        hr = conv->CopyPixels(nullptr, tw * 4, tw * th * 4, (BYTE*)bits);
        if (SUCCEEDED(hr)) *out = bmp;
        else DeleteObject(bmp);
      }
    }
    if (conv) conv->Release();
    if (scaler) scaler->Release();
    if (frame) frame->Release();
    if (decoder) decoder->Release();
    if (stream) stream->Release();
    factory->Release();
    return hr;
  }

  long refs_;
  std::vector<uint8_t> bytes_;
};

// ----------------------------------------------------- class factory ---

class Factory : public IClassFactory {
 public:
  Factory() : refs_(1) {}
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    static const QITAB qit[] = {QITABENT(Factory, IClassFactory), {0}};
    return QISearch(this, qit, riid, ppv);
  }
  IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs_); }
  IFACEMETHODIMP_(ULONG) Release() override {
    ULONG n = InterlockedDecrement(&refs_);
    if (n == 0) delete this;
    return n;
  }
  IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
    *ppv = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;
    BoardcacheThumb* obj = new (std::nothrow) BoardcacheThumb();
    if (!obj) return E_OUTOFMEMORY;
    HRESULT hr = obj->QueryInterface(riid, ppv);
    obj->Release();
    return hr;
  }
  IFACEMETHODIMP LockServer(BOOL lock) override {
    if (lock) InterlockedIncrement(&g_objects);
    else InterlockedDecrement(&g_objects);
    return S_OK;
  }

 private:
  long refs_;
};

// ----------------------------------------------------------- exports ---

extern "C" BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    g_module = inst;
    DisableThreadLibraryCalls(inst);
  }
  return TRUE;
}

STDAPI DllCanUnloadNow() { return g_objects == 0 ? S_OK : S_FALSE; }

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
  *ppv = nullptr;
  if (!IsEqualCLSID(clsid, CLSID_BoardcacheThumb)) return CLASS_E_CLASSNOTAVAILABLE;
  Factory* f = new (std::nothrow) Factory();
  if (!f) return E_OUTOFMEMORY;
  HRESULT hr = f->QueryInterface(riid, ppv);
  f->Release();
  return hr;
}

// Registration writes two things: the COM server under HKCR\CLSID and the
// per-extension thumbnail handler. HKCU works for per-user installs; the
// installer picks the hive. Also lists us in the shell-approved table.
static HRESULT setKey(HKEY root, const std::wstring& path, const wchar_t* name, const std::wstring& value) {
  HKEY key;
  LONG rc = RegCreateKeyExW(root, path.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr);
  if (rc != ERROR_SUCCESS) return HRESULT_FROM_WIN32(rc);
  rc = RegSetValueExW(key, name, 0, REG_SZ, (const BYTE*)value.c_str(),
                      (DWORD)((value.size() + 1) * sizeof(wchar_t)));
  RegCloseKey(key);
  return HRESULT_FROM_WIN32(rc);
}

static HRESULT registerIn(HKEY root) {
  wchar_t path[MAX_PATH];
  if (!GetModuleFileNameW(g_module, path, MAX_PATH)) return E_FAIL;
  std::wstring clsid = std::wstring(L"Software\\Classes\\CLSID\\") + kClsidText;
  HRESULT hr = setKey(root, clsid, nullptr, L"boardCache Thumbnail Provider");
  if (SUCCEEDED(hr)) hr = setKey(root, clsid + L"\\InprocServer32", nullptr, path);
  if (SUCCEEDED(hr)) hr = setKey(root, clsid + L"\\InprocServer32", L"ThreadingModel", L"Apartment");
  if (SUCCEEDED(hr))
    hr = setKey(root, std::wstring(L"Software\\Classes\\.boardcache\\ShellEx\\") + kThumbHandler,
                nullptr, kClsidText);
  if (SUCCEEDED(hr) && root == HKEY_LOCAL_MACHINE)
    hr = setKey(root, L"Software\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Approved",
                kClsidText, L"boardCache Thumbnail Provider");
  return hr;
}

static void unregisterIn(HKEY root) {
  SHDeleteKeyW(root, (std::wstring(L"Software\\Classes\\CLSID\\") + kClsidText).c_str());
  SHDeleteKeyW(root, (std::wstring(L"Software\\Classes\\.boardcache\\ShellEx\\") + kThumbHandler).c_str());
  HKEY key;
  if (RegOpenKeyExW(root, L"Software\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Approved",
                    0, KEY_SET_VALUE, &key) == ERROR_SUCCESS) {
    RegDeleteValueW(key, kClsidText);
    RegCloseKey(key);
  }
}

STDAPI DllRegisterServer() {
  HRESULT hr = registerIn(HKEY_LOCAL_MACHINE);
  if (FAILED(hr)) hr = registerIn(HKEY_CURRENT_USER);  // per-user install
  if (SUCCEEDED(hr)) SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
  return hr;
}

STDAPI DllUnregisterServer() {
  unregisterIn(HKEY_LOCAL_MACHINE);
  unregisterIn(HKEY_CURRENT_USER);
  SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
  return S_OK;
}
