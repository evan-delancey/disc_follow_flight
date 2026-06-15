import Capacitor
import StoreKit

/// Capacitor plugin wrapping StoreKit 2 for subscription management.
/// Exposes getSubscriptionStatus, purchase, and restorePurchases to JavaScript.
@objc(StoreKit2Plugin)
public class StoreKit2Plugin: CAPPlugin {

    private let productID = "com.evandel.discfollowflight.monthly"

    // ── Check whether the user has an active subscription ──────────────────
    @objc func getSubscriptionStatus(_ call: CAPPluginCall) {
        Task {
            var isActive = false
            for await result in Transaction.currentEntitlements {
                if case .verified(let tx) = result,
                   tx.productID == self.productID,
                   tx.revocationDate == nil {
                    isActive = true
                    break
                }
            }
            call.resolve(["active": isActive])
        }
    }

    // ── Initiate a purchase (shows Apple's native payment sheet) ───────────
    @objc func purchase(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                let products = try await Product.products(for: [self.productID])
                guard let product = products.first else {
                    call.reject("Product not found — check App Store Connect setup.")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    switch verification {
                    case .verified(let tx):
                        await tx.finish()
                        call.resolve(["success": true])
                    case .unverified(_, let err):
                        call.reject("Verification failed: \(err.localizedDescription)")
                    }
                case .userCancelled:
                    call.reject("cancelled")
                case .pending:
                    // Purchase is awaiting approval (e.g. Ask to Buy)
                    call.resolve(["success": false, "pending": true])
                @unknown default:
                    call.reject("Unknown purchase result")
                }
            } catch {
                call.reject("Purchase error: \(error.localizedDescription)")
            }
        }
    }

    // ── Restore existing purchases (required by App Store guidelines) ───────
    @objc func restorePurchases(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                call.resolve(["success": true])
            } catch {
                call.reject("Restore failed: \(error.localizedDescription)")
            }
        }
    }
}
