import AppKit
import QuickLookThumbnailing

/// Finder, Spotlight and the Open dialog ask here for a `.boardcache`
/// thumbnail. We hand back the file's own preview, scaled to fit.
final class ThumbnailProvider: QLThumbnailProvider {
    override func provideThumbnail(
        for request: QLFileThumbnailRequest,
        _ handler: @escaping (QLThumbnailReply?, Error?) -> Void
    ) {
        guard let data = try? Data(contentsOf: request.fileURL, options: .mappedIfSafe),
              let png = BoardcacheZip.thumbnail(in: data),
              let image = NSImage(data: png),
              image.size.width > 0, image.size.height > 0
        else {
            handler(nil, nil) // generic icon
            return
        }
        let maximum = request.maximumSize
        let aspect = image.size.width / image.size.height
        var size = maximum
        if maximum.width / maximum.height > aspect {
            size.width = maximum.height * aspect
        } else {
            size.height = maximum.width / aspect
        }
        let reply = QLThumbnailReply(contextSize: size, currentContextDrawing: { () -> Bool in
            image.draw(in: CGRect(origin: .zero, size: size))
            return true
        })
        handler(reply, nil)
    }
}
