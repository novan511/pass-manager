import Foundation

/// Supabase Auth via REST (no extra SPM dependency required for auth).
/// App tables still go through Keyring Next.js API with Bearer token.
enum AuthService {
    private static var baseURL: URL {
        URL(string: Config.supabaseURL)!
    }

    private static let anon = Config.supabaseAnonKey

    struct Session {
        let accessToken: String
        let refreshToken: String
        let expiresIn: Int
    }

    static func signUp(email: String, password: String) async throws -> Session {
        // 1) Create auth user via app API (uses service_role on server)
        //    so org profile is created consistently with web signup.
        let body = try JSONSerialization.data(withJSONObject: [
            "email": email,
            "password": password,
        ])
        var req = URLRequest(url: URL(string: "\(Config.apiBaseURL)/api/auth/signup")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (_, signupRes) = try await URLSession.shared.data(for: req)
        guard let http = signupRes as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            // Still try local sign-in if account already exists in Supabase Auth
            return try await signIn(email: email, password: password)
        }

        // 2) Sign in to get access_token for API Bearer calls
        return try await signIn(email: email, password: password)
    }

    static func signIn(email: String, password: String) async throws -> Session {
        var req = URLRequest(url: baseURL.appendingPathComponent("auth/v1/token?grant_type=password"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anon, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "email": email,
            "password": password,
        ])
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard http.statusCode == 200 else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error_description"] as? String
                ?? (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["msg"] as? String
                ?? "Sign in failed."
            throw NSError(domain: "Auth", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: msg])
        }
        let session = try JSONDecoder().decode(SessionTokenResponse.self, from: data)
        return Session(
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresIn: session.expires_in ?? 3600
        )
    }

    static func refresh(refreshToken: String) async throws -> Session {
        var req = URLRequest(url: baseURL.appendingPathComponent("auth/v1/token?grant_type=refresh_token"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anon, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "refresh_token": refreshToken,
        ])
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "Auth", code: 1, userInfo: [NSLocalizedDescriptionKey: "Session expired. Sign in again."])
        }
        let session = try JSONDecoder().decode(SessionTokenResponse.self, from: data)
        return Session(
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresIn: session.expires_in ?? 3600
        )
    }

    private struct SessionTokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Int?
    }
}
