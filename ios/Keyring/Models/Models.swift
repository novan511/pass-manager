import Foundation

// MARK: - API DTOs (camelCase JSON from Next.js)

struct AppUser: Codable, Identifiable {
    let id: String
    let email: String
    let displayName: String?
    let avatar: String?
    let role: String
    let orgRole: String?
    let platformRole: String?
    let organizationId: String?
    let organization: OrgBrief?
    let allowedCategories: [String]?
}

struct OrgBrief: Codable {
    let id: String
    let name: String
    let slug: String
    let status: String?
}

struct MeResponse: Codable {
    let user: AppUser
    let hasVault: Bool
    let passkeyCount: Int
}

struct VaultProfileResponse: Codable {
    let profile: VaultProfile?
}

struct EncryptedItemRow: Codable, Identifiable {
    let id: String
    let ciphertext: String
    let iv: String
    let category: String?
    let updatedAt: String?
    let createdAt: String?
}

struct ItemsResponse: Codable {
    let items: [EncryptedItemRow]
    let allowedCategories: [String]?
    let role: String?
}

struct VaultItem: Identifiable, Codable {
    let id: String
    var name: String
    var username: String?
    var password: String?
    var url: String?
    var notes: String?
    var totp: String?
    var favorite: Bool
    var category: String
    var updatedAt: String
    var scope: String // "personal" | "org"
}

struct OrgKeyResponse: Codable {
    let hasOrgKey: Bool
    let encryptedOrgKey: String?
    let organizationId: String?
}

struct OrgItemsResponse: Codable {
    let items: [EncryptedItemRow]
    let allowedCategories: [String]?
}

// MARK: - Auth (Supabase REST)

struct SupabaseAuthSession: Codable {
    let access_token: String
    let refresh_token: String
    let expires_in: Int?
    let token_type: String?
    let user: SupabaseAuthUser?
}

struct SupabaseAuthUser: Codable {
    let id: String
    let email: String?
}

struct SupabaseAuthError: Codable {
    let error_description: String?
    let msg: String?
    let code: Int?
}
