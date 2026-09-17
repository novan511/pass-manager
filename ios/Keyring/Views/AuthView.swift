import SwiftUI

struct AuthView: View {
    @EnvironmentObject var session: SessionStore
    @State private var mode: Mode = .signin
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false

    enum Mode { case signin, signup }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 8) {
                        Image(systemName: "lock.keyhole.fill")
                            .font(.system(size: 36))
                            .foregroundStyle(Color.accentColor)
                        Text("Keyring")
                            .font(.title2.weight(.semibold))
                        Text("Zero-knowledge passwords. Your master password never leaves this device.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 40)

                    Picker("Mode", selection: $mode) {
                        Text("Sign in").tag(Mode.signin)
                        Text("Create account").tag(Mode.signup)
                    }
                    .pickerStyle(.segmented)

                    VStack(spacing: 12) {
                        TextField("Email", text: $email)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()

                        HStack {
                            if showPassword {
                                TextField("Password", text: $password)
                                    .textFieldStyle(.roundedBorder)
                            } else {
                                SecureField("Password", text: $password)
                                    .textFieldStyle(.roundedBorder)
                            }
                            Button {
                                showPassword.toggle()
                            } label: {
                                Image(systemName: showPassword ? "eye.slash" : "eye")
                            }
                        }

                        if mode == .signup {
                            PasswordChecklistView(password: password)
                        }
                    }

                    if let error = session.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }

                    Button {
                        Task {
                            if mode == .signin {
                                await session.signIn(email: email, password: password)
                            } else {
                                await session.signUp(email: email, password: password)
                            }
                        }
                    } label: {
                        if session.busy {
                            ProgressView()
                        } else {
                            Text(mode == .signin ? "Sign in" : "Create account")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(session.busy || email.isEmpty || password.isEmpty)

                    Text("Vault master password is set after sign-in. Account password only unlocks Keyring.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }
                .padding(24)
            }
        }
    }
}

struct PasswordChecklistView: View {
    let password: String

    private var checks: [(String, Bool)] {
        [
            ("At least 8 characters", password.count >= 8),
            ("Uppercase (A–Z)", password.range(of: "[A-Z]", options: .regularExpression) != nil),
            ("Lowercase (a–z)", password.range(of: "[a-z]", options: .regularExpression) != nil),
            ("Symbol or number", password.range(of: "[^A-Za-z0-9]", options: .regularExpression) != nil),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(checks, id: \.0) { label, ok in
                HStack(spacing: 8) {
                    Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle")
                        .foregroundStyle(ok ? Color.green : Color.secondary)
                        .font(.caption)
                    Text(label)
                        .font(.caption)
                        .foregroundStyle(ok ? Color.green : Color.secondary)
                }
            }
        }
    }
}
