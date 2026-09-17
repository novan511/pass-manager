import SwiftUI

@main
struct KeyringApp: App {
    @StateObject private var session = SessionStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .onAppear {
                    // Restore session from keychain
                    if session.accessToken != nil && session.user == nil {
                        Task {
                            await session.refreshProfile()
                        }
                    }
                }
                .onChange(of: scenePhase) { phase in
                    if phase == .background || phase == .inactive {
                        // Optional: lock on background — uncomment to force
                        // session.lockVault()
                    }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var session: SessionStore

    var body: some View {
        Group {
            if session.user == nil {
                AuthView()
            } else if !session.hasVault {
                SetupVaultView()
            } else if !session.unlocked {
                UnlockView()
            } else {
                MainTabView()
            }
        }
        .preferredColorScheme(.dark)
    }
}
