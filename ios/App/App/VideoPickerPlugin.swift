import Capacitor
import PhotosUI

/// A Capacitor plugin that presents PHPickerViewController (photo library only,
/// no camera option) so the user can pick a video without the "Take Video"
/// action that crashes on iPad.
@objc(VideoPickerPlugin)
public class VideoPickerPlugin: CAPPlugin {
    private var pendingCall: CAPPluginCall?

    @objc func pickFromLibrary(_ call: CAPPluginCall) {
        self.pendingCall = call
        DispatchQueue.main.async {
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.filter = .videos
            config.selectionLimit = 1
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }
}

extension VideoPickerPlugin: PHPickerViewControllerDelegate {
    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pendingCall else { return }
        pendingCall = nil

        guard let result = results.first else {
            call.reject("cancelled")
            return
        }

        result.itemProvider.loadFileRepresentation(forTypeIdentifier: "public.movie") { url, error in
            if let error = error {
                call.reject("Failed to load video: \(error.localizedDescription)")
                return
            }
            guard let url = url else {
                call.reject("No URL returned")
                return
            }
            let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
            let destURL = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString + "." + ext)
            do {
                try FileManager.default.copyItem(at: url, to: destURL)
                call.resolve(["url": destURL.absoluteString])
            } catch {
                call.reject("Failed to copy video: \(error.localizedDescription)")
            }
        }
    }
}
