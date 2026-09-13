/* Keyring extension popup — decrypts locally with the master password. */

const PBKDF2_ITERATIONS = 310000;

const $ = (id) => document.getElementById(id);
const errorEl = $("error");

function showError(msg) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg || "";
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(u8) {
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

async function deriveKek(password, saltB64, iterations) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt", "unwrapKey"],
  );
}

async function decryptPacked(kek, packed) {
  const [ivB64, ctB64] = packed.split(".");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(ivB64) },
    kek,
    b64ToBytes(ctB64),
  );
  return new Uint8Array(pt);
}

async function unlockWithPassword(password, profile) {
  const kek = await deriveKek(password, profile.kdfSalt, profile.kdfIterations || PBKDF2_ITERATIONS);
  const verifier = await decryptPacked(kek, profile.verifier);
  if (new TextDecoder().decode(verifier) !== "keyring-vault-verifier-v1") {
    throw new Error("Incorrect master password.");
  }
  const raw = await decryptPacked(kek, profile.wrappedDek);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decryptItem(dek, ciphertext, iv) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(iv) },
    dek,
    b64ToBytes(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function getState() {
  return chrome.storage.local.get(["apiBase", "token"]);
}

function showStage(name) {
  $("stage-token").hidden = name !== "token";
  $("stage-unlock").hidden = name !== "unlock";
  $("stage-list").hidden = name !== "list";
}

let vaultData = null;
let dek = null;
let decrypted = [];

async function fetchVault() {
  const { apiBase, token } = await getState();
  if (!apiBase || !token) {
    showStage("token");
    return;
  }
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/extension/vault`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not fetch vault.");
  vaultData = data;
  showStage("unlock");
  $("status").textContent = `Connected · ${data.user.email}`;
}

async function renderList(filter = "") {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabHost = tabs[0]?.url ? hostOf(tabs[0].url) : "";
  $("host").textContent = tabHost || "no tab";

  const q = filter.trim().toLowerCase();
  const list = decrypted.filter((item) => {
    if (item.type && item.type !== "login" && item.type !== "note") return false;
    if (!q) return true;
    return [item.name, item.username, item.url]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  const container = $("items");
  container.innerHTML = "";
  if (list.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);margin:10px 0">No matching logins.</p>`;
    return;
  }

  for (const item of list) {
    const btn = document.createElement("button");
    btn.className = "item secondary";
    btn.innerHTML = `<strong></strong><span></span>`;
    btn.querySelector("strong").textContent = item.name || "Untitled";
    const sub = [item.username, item.url].filter(Boolean).join(" · ");
    btn.querySelector("span").textContent = sub;
    const match = tabHost && item.url && hostOf(item.url).includes(tabHost);
    if (match) btn.style.borderColor = "var(--accent)";
    btn.addEventListener("click", () => fillActiveTab(item));
    container.appendChild(btn);
  }
}

async function fillActiveTab(item) {
  showError("");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (payload) => {
        function visible(el) {
          const s = window.getComputedStyle(el);
          return s.visibility !== "hidden" && s.display !== "none" && el.offsetParent !== null;
        }
        const inputs = Array.from(document.querySelectorAll("input")).filter(visible);
        const password =
          inputs.find((el) => el.type === "password") ||
          inputs.find((el) => /pass/i.test(el.name || el.id || el.placeholder || ""));
        if (!password) {
          alert("Keyring: no password field found on this page.");
          return;
        }
        password.value = payload.password || "";
        password.dispatchEvent(new Event("input", { bubbles: true }));
        password.dispatchEvent(new Event("change", { bubbles: true }));

        if (payload.username) {
          const user =
            inputs.find(
              (el) =>
                el !== password &&
                ["email", "text", "tel"].includes(el.type) &&
                /user|email|login|account|name/i.test(
                  `${el.name} ${el.id} ${el.placeholder} ${el.autocomplete}`,
                ),
            ) ||
            inputs.find((el) => el !== password && (el.type === "email" || el.autocomplete === "username"));
          if (user) {
            user.value = payload.username;
            user.dispatchEvent(new Event("input", { bubbles: true }));
            user.dispatchEvent(new Event("change", { bubbles: true }));
            user.focus();
          }
        }
        password.focus();
      },
      args: [{ username: item.username || "", password: item.password || "" }],
    });
    window.close();
  } catch (err) {
    showError(`Fill failed: ${err.message}. Open a normal http(s) page and try again.`);
  }
}

$("save-token").addEventListener("click", async () => {
  showError("");
  const apiBase = $("api").value.trim();
  const token = $("token").value.trim();
  if (!apiBase || !token) {
    showError("Enter the base URL and a token.");
    return;
  }
  await chrome.storage.local.set({ apiBase, token });
  try {
    await fetchVault();
  } catch (err) {
    showError(err.message);
  }
});

$("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove(["apiBase", "token"]);
  vaultData = null;
  decrypted = [];
  showStage("token");
  $("status").textContent = "Encrypted vault · unlocked on this device only";
});

$("unlock").addEventListener("click", async () => {
  showError("");
  const password = $("master").value;
  if (!password || !vaultData?.profile) {
    showError("Enter your master password.");
    return;
  }
  try {
    dek = await unlockWithPassword(password, vaultData.profile);
    decrypted = [];
    for (const row of vaultData.items) {
      try {
        const data = await decryptItem(dek, row.ciphertext, row.iv);
        decrypted.push({ ...data, id: row.id });
      } catch {
        /* skip corrupt item */
      }
    }
    $("master").value = "";
    showStage("list");
    $("status").textContent = `${decrypted.length} items unlocked locally`;
    await renderList();
  } catch (err) {
    showError(err.message);
  }
});

$("lock").addEventListener("click", () => {
  dek = null;
  decrypted = [];
  showStage("unlock");
  $("status").textContent = "Vault locked";
});

$("search").addEventListener("input", (e) => {
  renderList(e.target.value);
});

(async function init() {
  try {
    const { apiBase } = await getState();
    if (apiBase) $("api").value = apiBase;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url && apiBase) {
      try {
        const u = new URL(tabs[0].url);
        if (!["http:", "https:"].includes(u.protocol)) return;
      } catch {
        /* ignore */
      }
    }
    await fetchVault();
  } catch (err) {
    showError(err.message);
  }
})();
