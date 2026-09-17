import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            VaultHomeView()
                .tabItem { Label("Vault", systemImage: "lock.rectangle") }
            GeneratorView()
                .tabItem { Label("Generator", systemImage: "wand.and.stars") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

struct VaultHomeView: View {
    @EnvironmentObject var session: SessionStore
    @State private var scope: String = "personal"
    @State private var query = ""
    @State private var selected: VaultItem?
    @State private var editing: VaultItem?
    @State private var showNew = false

    private var categories: [String] {
        session.allowedCategories.isEmpty
            ? ["work", "personal", "finance", "social", "other"]
            : session.allowedCategories
    }

    private var filtered: [VaultItem] {
        let base = scope == "org" ? session.orgItems : session.personalItems
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return base }
        return base.filter {
            $0.name.lowercased().contains(q)
                || ($0.username ?? "").lowercased().contains(q)
                || ($0.url ?? "").lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if session.user?.organizationId != nil {
                    Picker("Scope", selection: $scope) {
                        Text("Mine").tag("personal")
                        Text("Team").tag("org")
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .padding(.vertical, 10)
                }

                if scope == "org" && !session.hasOrgKey {
                    ContentUnavailableView(
                        "Team vault not unlocked",
                        systemImage: "person.2.slash",
                        description: Text("Ask the project owner to share the team vault. Team items you can already access will appear here.")
                    )
                    .frame(maxHeight: .infinity)
                } else {
                    List {
                        ForEach(filtered) { item in
                            Button {
                                selected = item
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(item.name)
                                            .font(.body.weight(.medium))
                                        if item.favorite {
                                            Image(systemName: "star.fill")
                                                .font(.caption2)
                                                .foregroundStyle(.yellow)
                                        }
                                        Spacer()
                                        if let code = totpCode(item) {
                                            Text(code)
                                                .font(.system(.caption, design: .monospaced))
                                                .foregroundStyle(Color.accentColor)
                                        }
                                    }
                                    if let u = item.username, !u.isEmpty {
                                        Text(u)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(categoryLabel(item.category))
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(Color.accentColor.opacity(0.15))
                                        .clipShape(Capsule())
                                }
                            }
                            .swipeActions {
                                Button(role: .destructive) {
                                    Task { await session.deleteItem(item) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                Button {
                                    editing = item
                                } label: {
                                    Label("Edit", systemImage: "pencil")
                                }
                                .tint(.blue)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable {
                        if scope == "org" { await session.reloadOrgItems() }
                        else { await session.reloadItems() }
                    }
                }
            }
            .navigationTitle(scope == "org" ? "Team logins" : "My logins")
            .searchable(text: $query, prompt: "Search logins")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showNew = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        session.signOut()
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .sheet(item: $selected) { item in
                ItemDetailView(item: item) {
                    editing = item
                    selected = nil
                } onDelete: {
                    Task {
                        await session.deleteItem(item)
                        selected = nil
                    }
                }
            }
            .sheet(isPresented: $showNew) {
                ItemEditorView(item: nil, scope: scope, categories: categories)
            }
            .sheet(item: $editing) { item in
                ItemEditorView(item: item, scope: item.scope, categories: categories)
            }
        }
    }

    private func totpCode(_ item: VaultItem) -> String? {
        guard let secret = item.totp, !secret.isEmpty else { return nil }
        return (try? TOTP.code(secret: secret))?.code
    }

    private func categoryLabel(_ c: String) -> String {
        let map = [
            "work": "Work", "personal": "Personal", "finance": "Finance",
            "social": "Social", "other": "Other",
        ]
        return map[c] ?? c.capitalized
    }
}

struct ItemDetailView: View {
    let item: VaultItem
    let onEdit: () -> Void
    let onDelete: () -> Void
    @State private var reveal = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent("Username", value: item.username ?? "—")
                    HStack {
                        Text("Password")
                        Spacer()
                        Text(reveal ? (item.password ?? "—") : "••••••••")
                            .font(.system(.body, design: .monospaced))
                        Button {
                            reveal.toggle()
                        } label: {
                            Image(systemName: reveal ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.borderless)
                    }
                    if let url = item.url, !url.isEmpty {
                        LabeledContent("Website", value: url)
                    }
                    if let secret = item.totp, let code = try? TOTP.code(secret: secret) {
                        LabeledContent("One-time code") {
                            Text(code.code)
                                .font(.system(.body, design: .monospaced))
                                .foregroundStyle(Color.accentColor)
                        }
                    }
                }
                Section {
                    Button("Copy password", role: .none) {
                        UIPasteboard.general.string = item.password
                    }
                    if let u = item.username {
                        Button("Copy username") {
                            UIPasteboard.general.string = u
                        }
                    }
                }
                Section {
                    Button("Edit", action: onEdit)
                    Button("Delete", role: .destructive, action: onDelete)
                }
            }
            .navigationTitle(item.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }
}

struct ItemEditorView: View {
    let item: VaultItem?
    let scope: String
    let categories: [String]

    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var username = ""
    @State private var password = ""
    @State private var url = ""
    @State private var notes = ""
    @State private var totp = ""
    @State private var category = "personal"
    @State private var favorite = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Login") {
                    TextField("Name", text: $name)
                    TextField("Username", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    HStack {
                        if showPassword {
                            TextField("Password", text: $password)
                        } else {
                            SecureField("Password", text: $password)
                        }
                        Button {
                            showPassword.toggle()
                        } label: {
                            Image(systemName: showPassword ? "eye.slash" : "eye")
                        }
                        Button {
                            password = PasswordGenerator.password(length: 20)
                        } label: {
                            Image(systemName: "wand.and.stars")
                        }
                    }
                    TextField("Website", text: $url)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("TOTP secret (optional)", text: $totp)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }

                Section("Details") {
                    Picker("Category", selection: $category) {
                        ForEach(categories, id: \.self) { c in
                            Text(c.capitalized).tag(c)
                        }
                    }
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                    Toggle("Favorite", isOn: $favorite)
                }

                if let error = session.errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }

                Section {
                    Button {
                        Task {
                            let payload = VaultItem(
                                id: item?.id ?? "",
                                name: name,
                                username: username.isEmpty ? nil : username,
                                password: password.isEmpty ? nil : password,
                                url: url.isEmpty ? nil : url,
                                notes: notes.isEmpty ? nil : notes,
                                totp: totp.isEmpty ? nil : totp,
                                favorite: favorite,
                                category: category,
                                updatedAt: item?.updatedAt ?? "",
                                scope: scope
                            )
                            await session.saveItem(payload, scope: scope)
                            dismiss()
                        }
                    } label: {
                        if session.busy {
                            ProgressView()
                        } else {
                            Text("Save login")
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || session.busy)
                }
            }
            .navigationTitle(item == nil ? "New login" : "Edit login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                if let item {
                    name = item.name
                    username = item.username ?? ""
                    password = item.password ?? ""
                    url = item.url ?? ""
                    notes = item.notes ?? ""
                    totp = item.totp ?? ""
                    category = item.category
                    favorite = item.favorite
                } else if let first = categories.first {
                    category = first
                }
            }
        }
    }

    @State private var showPassword = false
}
