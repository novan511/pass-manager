import Foundation
import Security

/// Password / passphrase generator — CSPRNG, same spirit as web.
enum PasswordGenerator {
    private static let lower = Array("abcdefghijkmnopqrstuvwxyz")
    private static let upper = Array("ABCDEFGHJKLMNPQRSTUVWXYZ")
    private static let digits = Array("23456789")
    private static let symbols = Array("!@#$%^&*()-_=+[]{};:,.?/")
    private static let words = [
        "correct","horse","battery","staple","anchor","amber","arrow","autumn",
        "beacon","bishop","breeze","canyon","cedar","cipher","clover","compass",
        "coral","crater","crystal","dancer","delta","desert","diamond","dolphin",
        "eagle","ember","equinox","falcon","fjord","galaxy","garden","glacier",
        "granite","harbor","harvest","horizon","indigo","ivory","jaguar","jungle",
        "lantern","lemon","lunar","lyric","magnet","maple","meadow","meteor",
        "mirage","mocha","nebula","nickel","nomad","north","octave","onyx",
        "orbit","orchid","otter","panda","pebble","pepper","phoenix","planet",
        "plasma","plume","prairie","quartz","rabbit","radar","raven","river",
        "rocket","saffron","sailor","scarlet","shadow","silver","sonar","sparrow",
        "summit","sunset","tempest","thunder","timber","topaz","tornado","trail",
        "tulip","umbrella","valley","velvet","violet","walnut","whisper","willow",
        "winter","wonder","xenon","yonder","zebra","zephyr",
    ]

    private static func randomInt(_ max: Int) -> Int {
        var value: UInt32 = 0
        _ = SecRandomCopyBytes(kSecRandomDefault, MemoryLayout<UInt32>.size, &value)
        return Int(value % UInt32(max))
    }

    static func password(
        length: Int,
        upper: Bool = true,
        lower: Bool = true,
        digits: Bool = true,
        symbols: Bool = true
    ) -> String {
        var pool = ""
        var classes: [String] = []
        if lower { pool += String(self.lower); classes.append(String(self.lower)) }
        if upper { pool += String(self.upper); classes.append(String(self.upper)) }
        if digits { pool += String(self.digits); classes.append(String(self.digits)) }
        if symbols { pool += String(self.symbols); classes.append(String(self.symbols)) }
        if pool.isEmpty { pool = String(lower ? self.lower : self.upper) }

        var chars: [Character] = []
        for cls in classes where chars.count < length {
            chars.append(cls.randomElement()!)
        }
        let poolChars = Array(pool)
        while chars.count < length {
            chars.append(poolChars[randomInt(poolChars.count)])
        }
        // shuffle
        for i in stride(from: chars.count - 1, through: 1, by: -1) {
            let j = randomInt(i + 1)
            chars.swapAt(i, j)
        }
        return String(chars)
    }

    static func passphrase(words: Int, separator: String = "-", capitalize: Bool = false, includeNumber: Bool = true) -> String {
        var picked: [String] = []
        for _ in 0..<words {
            var w = self.words.randomElement()!
            if capitalize { w = w.prefix(1).uppercased() + w.dropFirst() }
            picked.append(w)
        }
        var phrase = picked.joined(separator: separator)
        if includeNumber {
            phrase += separator + String(10 + randomInt(90))
        }
        return phrase
    }
}
