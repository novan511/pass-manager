import Foundation

/// Calls the same Next.js API as the web app, using Supabase access_token as Bearer.
final class APIClient {
    static let shared = APIClient()
    private init() {}

    var accessToken: String?

    private var base: URL {
        URL(string: Config.apiBaseURL.replacingOccurrences(of: "/", with: "", options: [], range: nil))!
    }

    private func url(_ path: String) -> URL {
        base.appendingPathComponent(path)
    }

    private func request(
        _ path: String,
        method: String = "GET",
        body: Data? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var req = URLRequest(url: url(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body
        req.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return (data, http)
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: Account

    func me() async throws -> MeResponse {
        let (data, res) = try await request("/api/auth/me")
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        return try decode(MeResponse.self, from: data)
    }

    func signup(email: String, password: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "email": email,
            "password": password,
        ])
        // Signup creates Supabase Auth + app user; session cookies not used on iOS.
        // We call Supabase Auth sign-up separately in AuthService, then ensure profile via /api/auth/me.
        let (data, res) = try await request("/api/auth/signup", method: "POST", body: body)
        guard res.statusCode == 200 || res.statusCode == 201 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
    }

    // MARK: Vault profile

    func vaultProfile() async throws -> VaultProfileResponse {
        let (data, res) = try await request("/api/vault/profile")
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        return try decode(VaultProfileResponse.self, from: data)
    }

    func saveVaultProfile(_ profile: VaultProfile) async throws -> VaultProfileResponse {
        let body = try JSONEncoder().encode(profile)
        let (data, res) = try await request("/api/vault/profile", method: "PUT", body: body)
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        return try decode(VaultProfileResponse.self, from: data)
    }

    // MARK: Personal items

    func personalItems() async throws -> ItemsResponse {
        let (data, res) = try await request("/api/vault/items")
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        return try decode(ItemsResponse.self, from: data)
    }

    func createPersonalItem(ciphertext: String, iv: String, category: String) async throws -> EncryptedItemRow {
        let body = try JSONSerialization.data(withJSONObject: [
            "ciphertext": ciphertext,
            "iv": iv,
            "category": category,
        ])
        let (data, res) = try await request("/api/vault/items", method: "POST", body: body)
        guard res.statusCode == 201 || res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        struct Wrapper: Codable { let item: EncryptedItemRow }
        return try decode(Wrapper.self, from: data).item
    }

    func updatePersonalItem(id: String, ciphertext: String, iv: String, category: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "ciphertext": ciphertext,
            "iv": iv,
            "category": category,
        ])
        let (data, res) = try await request("/api/vault/items/\(id)", method: "PUT", body: body)
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
    }

    func deletePersonalItem(id: String) async throws {
        let (data, res) = try await request("/api/vault/items/\(id)", method: "DELETE")
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
    }

    // MARK: Org (Team) vault

    func orgKey() async throws -> OrgKeyResponse {
        let (data, res) = try await request("/api/org/key")
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        return try decode(OrgKeyResponse.self, from: data)
    }

    func orgItems() async throws -> OrgItemsResponse {
        let (data, res) = try await request("/api/org/items")
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        return try decode(OrgItemsResponse.self, from: data)
    }

    func createOrgItem(ciphertext: String, iv: String, category: String) async throws -> EncryptedItemRow {
        let body = try JSONSerialization.data(withJSONObject: [
            "ciphertext": ciphertext,
            "iv": iv,
            "category": category,
        ])
        let (data, res) = try await request("/api/org/items", method: "POST", body: body)
        guard res.statusCode == 201 || res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
        struct Wrapper: Codable { let item: EncryptedItemRow }
        return try decode(Wrapper.self, from: data).item
    }

    func updateOrgItem(id: String, ciphertext: String, iv: String, category: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "ciphertext": ciphertext,
            "iv": iv,
            "category": category,
        ])
        let (data, res) = try await request("/api/org/items/\(id)", method: "PUT", body: body)
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
    }

    func deleteOrgItem(id: String) async throws {
        let (data, res) = try await request("/api/org/items/\(id)", method: "DELETE")
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
    }

    // MARK: Profile

    func updateProfile(displayName: String?, avatar: String?) async throws {
        var obj: [String: Any] = [:]
        if let displayName { obj["displayName"] = displayName }
        if let avatar { obj["avatar"] = avatar }
        let body = try JSONSerialization.data(withJSONObject: obj)
        let (data, res) = try await request("/api/auth/profile", method: "PATCH", body: body)
        guard res.statusCode == 200 else {
            throw APIClientError.server(message: Self.errorMessage(data), status: res.statusCode)
        }
    }

    private static func errorMessage(_ data: Data) -> String {
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = obj["error"] as? String {
            return msg
        }
        return String(data: data, encoding: .utf8) ?? "Request failed"
    }
}

enum APIClientError: LocalizedError {
    case server(message: String, status: Int)
    case network

    var errorDescription: String? {
        switch self {
        case .server(let message, _): return message
        case .network: return "Network error. Check your connection."
        }
    }
}
