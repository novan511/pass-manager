import SwiftUI

struct GeneratorView: View {
    @State private var mode = "password"
    @State private var value = ""
    @State private var length = 20
    @State private var words = 5
    @State private var includeUpper = true
    @State private var includeDigits = true
    @State private var includeSymbols = true
    @State private var show = true
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $mode) {
                        Text("Password").tag("password")
                        Text("Passphrase").tag("passphrase")
                    }
                    .pickerStyle(.segmented)
                }

                Section("Result") {
                    HStack {
                        Text(show ? value : String(repeating: "•", count: min(value.count, 24)))
                            .font(.system(.body, design: .monospaced))
                            .lineLimit(2)
                        Spacer()
                        Button {
                            show.toggle()
                        } label: {
                            Image(systemName: show ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.borderless)
                    }
                    HStack {
                        Button {
                            UIPasteboard.general.string = value
                            copied = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                copied = false
                            }
                        } label: {
                            Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                        Spacer()
                        Button {
                            regenerate()
                        } label: {
                            Label("Regenerate", systemImage: "arrow.clockwise")
                        }
                    }
                    .foregroundStyle(Color.accentColor)
                }

                if mode == "password" {
                    Section("Options") {
                        Stepper("Length: \(length)", value: $length, in: 8...64)
                        Toggle("Uppercase", isOn: $includeUpper)
                        Toggle("Numbers", isOn: $includeDigits)
                        Toggle("Symbols", isOn: $includeSymbols)
                    }
                } else {
                    Section("Options") {
                        Stepper("Words: \(words)", value: $words, in: 3...10)
                    }
                }

                Section {
                    Text("Generated with the system CSPRNG on this device. Nothing is sent to the server.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Generator")
            .onAppear { regenerate() }
            .onChange(of: mode) { _ in regenerate() }
            .onChange(of: length) { _ in regenerate() }
            .onChange(of: words) { _ in regenerate() }
            .onChange(of: includeUpper) { _ in regenerate() }
            .onChange(of: includeDigits) { _ in regenerate() }
            .onChange(of: includeSymbols) { _ in regenerate() }
        }
    }

    private func regenerate() {
        if mode == "password" {
            value = PasswordGenerator.password(
                length: length,
                upper: includeUpper,
                lower: true,
                digits: includeDigits,
                symbols: includeSymbols
            )
        } else {
            value = PasswordGenerator.passphrase(words: words)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var displayName = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    LabeledContent("Email", value: session.user?.email ?? "—")
                    LabeledContent(
                        "Role",
                        value: session.user?.orgRole ?? session.user?.role ?? "—"
                    )
                    if let org = session.user?.organization?.name {
                        LabeledContent("Project", value: org)
                    }
                }

                Section("Profile") {
                    TextField("Display name", text: $displayName)
                    Button {
                        Task {
                            busy = true
                            try? await APIClient.shared.updateProfile(
                                displayName: displayName.isEmpty ? nil : displayName,
                                avatar: nil
                            )
                            await session.refreshProfile()
                            busy = false
                        }
                    } label: {
                        if busy { ProgressView() } else { Text("Save profile") }
                    }
                }

                Section("Categories") {
                    if session.allowedCategories.isEmpty {
                        Text("No categories granted yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(session.allowedCategories, id: \.self) { c in
                            Text(c.capitalized)
                        }
                    }
                }

                Section("Security") {
                    Button("Lock vault now", role: .destructive) {
                        session.lockVault()
                    }
                    Button("Sign out", role: .destructive) {
                        session.signOut()
                    }
                }

                Section {
                    Text("Master passwords and secrets are encrypted on-device only (AES-256-GCM).")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                displayName = session.user?.displayName ?? ""
            }
        }
    }
}
