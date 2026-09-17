import SwiftUI

struct SetupVaultView: View {
    @EnvironmentObject var session: SessionStore
    @State private var password = ""
    @State private var confirm = ""
    @State private var show = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Image(systemName: "lock.shield")
                            .font(.system(size: 40))
                            .foregroundStyle(Color.accentColor)
                        Text("Create your vault")
                            .font(.title2.weight(.semibold))
                        Text("This master password encrypts every secret on this device. We never see it — if you lose it, the vault cannot be recovered.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 40)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Master password")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack {
                            if show {
                                TextField("••••••••••••", text: $password)
                            } else {
                                SecureField("••••••••••••", text: $password)
                            }
                            Button { show.toggle() } label: {
                                Image(systemName: show ? "eye.slash" : "eye")
                            }
                        }
                        .textFieldStyle(.roundedBorder)

                        Text("Confirm")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if show {
                            TextField("••••••••••••", text: $confirm)
                        } else {
                            SecureField("••••••••••••", text: $confirm)
                        }
                        .textFieldStyle(.roundedBorder)

                        PasswordChecklistView(password: password)
                    }

                    if password != confirm && !confirm.isEmpty {
                        Text("Passwords do not match")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    if let error = session.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button {
                        Task { await session.setupVault(masterPassword: password) }
                    } label: {
                        if session.busy {
                            ProgressView()
                        } else {
                            Text("Encrypt my vault")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(session.busy || password.count < 8 || password != confirm)
                }
                .padding(24)
            }
        }
    }
}

struct UnlockView: View {
    @EnvironmentObject var session: SessionStore
    @State private var password = ""
    @State private var show = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Image(systemName: "lock.keyhole")
                            .font(.system(size: 40))
                            .foregroundStyle(Color.accentColor)
                        Text("Vault locked")
                            .font(.title2.weight(.semibold))
                        Text("Enter your master password to decrypt this vault on this device.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 50)

                    HStack {
                        if show {
                            TextField("••••••••••••", text: $password)
                        } else {
                            SecureField("••••••••••••", text: $password)
                        }
                        Button { show.toggle() } label: {
                            Image(systemName: show ? "eye.slash" : "eye")
                        }
                    }
                    .textFieldStyle(.roundedBorder)

                    if let error = session.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button {
                        Task { await session.unlock(masterPassword: password) }
                    } label: {
                        if session.busy {
                            ProgressView()
                        } else {
                            Text("Unlock vault")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(session.busy || password.isEmpty)

                    Text("AES-256-GCM · PBKDF2 310k")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                .padding(24)
            }
        }
    }
}
