"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  LayoutGrid,
  Star,
  Globe,
  Wand2,
  Settings,
  Shield,
  Lock,
  LogOut,
  Plus,
  Search,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  X,
  Loader2,
  Menu,
  Sparkles,
  Briefcase,
  User,
  Landmark,
  Hash,
  CircleDot,
  Sun,
  Moon,
} from "lucide-react";
import type { VaultItemData } from "@/lib/crypto";
import { generateTotp, extractTotpSecret } from "@/lib/totp";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
} from "@/lib/categories";
import {
  useVault,
  getTheme,
  setTheme,
  getThemePref,
  getAutoLockMinutes,
  setAutoLockMinutes,
  applyTheme,
  resolveTheme,
  watchSystemTheme,
  type DecryptedItem,
} from "./useVault";
import { UnlockScreen } from "./UnlockScreen";
import { GeneratorPanel } from "./GeneratorPanel";

type Filter = "all" | "favorites" | Category | "generator" | "settings" | "admin";

const CATEGORY_ICONS: Record<Category, React.ReactNode> = {
  work: <Briefcase size={14} />,
  personal: <User size={14} />,
  finance: <Landmark size={14} />,
  social: <Hash size={14} />,
  other: <CircleDot size={14} />,
};

function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, toast: setMsg };
}

function ThemeToggle() {
  const [pref, setPref] = useState<"system" | "dark" | "light">("system");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const p = getThemePref();
    setPref(p);
    setResolved(getTheme());
    const unwatch = watchSystemTheme(() => {
      if (getThemePref() === "system") {
        applyTheme("system");
        setResolved(getTheme());
      }
    });
    return unwatch;
  }, []);

  const next = pref === "system" ? "dark" : pref === "dark" ? "light" : "system";
  const label =
    pref === "system" ? "Theme: system" : pref === "dark" ? "Theme: dark" : "Theme: light";

  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      title={label}
      aria-label={label}
      onClick={() => {
        setTheme(next);
        setPref(next);
        setResolved(resolveTheme(next));
      }}
    >
      {resolved === "dark" ? <Moon size={14} /> : <Sun size={14} />}
      <span className="hidden sm:inline">
        {pref === "system" ? "Auto" : pref === "dark" ? "Dark" : "Light"}
      </span>
    </button>
  );
}

export function VaultApp() {
  const vault = useVault();
  const router = useRouter();
  const { toast, msg: toastMsg } = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | DecryptedItem | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [scope, setScope] = useState<"personal" | "org">("personal");
  const [totpMap, setTotpMap] = useState<Record<string, { code: string; secondsRemaining: number }>>({});

  const canPasskeyUnlock = !!vault.profile?.passkeyPrfSalt && !!vault.profile?.wrappedDekPasskey;
  const allowed = vault.user?.allowedCategories ?? [];
  const activeItems = scope === "org" ? vault.orgItems : vault.items;
  const hasOrgAccess = vault.hasOrgKey;
  const isOrgOwner =
    vault.user?.orgRole === "owner" || vault.user?.role === "admin";
  const isTeamUser =
    !!vault.user?.organizationId && vault.user?.platformRole !== "superadmin";

  useEffect(() => {
    if (!vault.unlocked) {
      setTotpMap({});
      return;
    }
    let alive = true;
    async function tick() {
      const next: Record<string, { code: string; secondsRemaining: number }> = {};
      const list = [...vault.items, ...vault.orgItems];
      for (const item of list) {
        if (!item.totp) continue;
        try {
          next[item.id] = await generateTotp(extractTotpSecret(item.totp));
        } catch {
          /* invalid secret — skip */
        }
      }
      if (alive) setTotpMap(next);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [vault.unlocked, vault.items, vault.orgItems]);

  const filtered = useMemo(() => {
    let list = activeItems;
    if (filter === "favorites") list = list.filter((i) => i.favorite);
    else if (filter !== "all" && filter !== "generator" && filter !== "settings" && filter !== "admin") {
      list = list.filter((i) => i.category === filter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        [i.name, i.username, i.url, i.notes]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }, [activeItems, filter, query]);

  const selected = activeItems.find((i) => i.id === selectedId) ?? null;

  if (vault.loading) {
    return (
      <div className="min-h-screen grid place-items-center" style={{ color: "var(--muted)" }}>
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  if (!vault.user) {
    if (typeof window !== "undefined") router.replace("/login");
    return (
      <div className="min-h-screen grid place-items-center text-sm" style={{ color: "var(--muted)" }}>
        Redirecting to sign in…
      </div>
    );
  }

  if (!vault.hasVault) {
    return (
      <UnlockScreen
        mode="setup"
        hasPasskey={false}
        busy={vault.busy}
        error={vault.error}
        onPassword={vault.setupNewVault}
      />
    );
  }

  if (!vault.unlocked) {
    return (
      <UnlockScreen
        mode="unlock"
        hasPasskey={canPasskeyUnlock}
        busy={vault.busy}
        error={vault.error}
        onPassword={vault.unlockPassword}
        onPasskey={canPasskeyUnlock ? () => vault.unlockPasskey().catch(() => {}) : undefined}
      />
    );
  }

  const categoryNav = allowed.map((c) => ({
    id: c as Filter,
    label: CATEGORY_LABELS[c as Category] ?? c,
    icon: CATEGORY_ICONS[c as Category] ?? <CircleDot size={14} />,
  }));

  return (
    <div className="app-shell">
      <aside className="sidebar" data-open={mobileNav || undefined} style={mobileNav ? { display: "flex" } : undefined}>
        <div className="flex items-center gap-2 px-2 mb-3 font-semibold tracking-tight">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            <KeyRound size={14} />
          </span>
          Keyring
        </div>

        <button
          type="button"
          className="btn btn-primary w-full mb-3"
          onClick={() => {
            setFilter("all");
            setEditing("new");
            setMobileNav(false);
          }}
        >
          <Plus size={16} /> Add login
        </button>

        {vault.user.organizationId && (
          <div className="mb-3 grid grid-cols-2 gap-1 p-1 rounded-xl" style={{ background: "var(--surface-2)" }}>
            <button
              type="button"
              className={`btn btn-sm ${scope === "personal" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setScope("personal")}
            >
              Mine
            </button>
            <button
              type="button"
              className={`btn btn-sm ${scope === "org" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => {
                setScope("org");
                setMobileNav(false);
              }}
            >
              Team
            </button>
          </div>
        )}

        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          <button type="button" className="nav-item" data-active={filter === "all"} onClick={() => { setFilter("all"); setMobileNav(false); }}>
            <LayoutGrid size={16} /> All logins
          </button>
          <button type="button" className="nav-item" data-active={filter === "favorites"} onClick={() => { setFilter("favorites"); setMobileNav(false); }}>
            <Star size={16} /> Favorites
          </button>

          <p className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--faint)" }}>
            Categories
          </p>
          {categoryNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              data-active={filter === item.id}
              onClick={() => { setFilter(item.id); setMobileNav(false); }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}

          <button type="button" className="nav-item mt-2" data-active={filter === "generator"} onClick={() => { setFilter("generator"); setMobileNav(false); }}>
            <Wand2 size={16} /> Generator
          </button>
        </nav>

        <div className="pt-3 mt-3 space-y-0.5 border-t hairline">
          <button type="button" className="nav-item" data-active={filter === "settings"} onClick={() => { setFilter("settings"); setMobileNav(false); }}>
            <Settings size={16} /> Settings
          </button>
          {(vault.user.role === "admin" ||
            vault.user.orgRole === "owner" ||
            vault.user.platformRole === "superadmin") && (
            <button type="button" className="nav-item" data-active={filter === "admin"} onClick={() => { setFilter("admin"); setMobileNav(false); }}>
              <Shield size={16} />
              {vault.user.platformRole === "superadmin" ? "Platform" : "Team"}
            </button>
          )}
          <button type="button" className="nav-item" onClick={() => { vault.lock(); setSelectedId(null); }}>
            <Lock size={16} /> Lock vault
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>

        <div className="px-2 pt-3 mt-3 border-t hairline">
          <div className="flex items-center gap-2.5 min-w-0">
            {vault.user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={vault.user.avatar}
                alt=""
                className="h-9 w-9 rounded-full object-cover shrink-0 border"
                style={{ borderColor: "var(--border)" }}
              />
            ) : (
              <span className="avatar h-9 w-9 shrink-0" style={{ borderRadius: "50%" }}>
                {(vault.user.displayName || vault.user.email)
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {vault.user.displayName || vault.user.email.split("@")[0]}
              </p>
              <p className="text-[11px] truncate" style={{ color: "var(--faint)" }} title={vault.user.email}>
                {vault.user.platformRole === "superadmin"
                  ? "Platform owner"
                  : vault.user.orgRole === "owner"
                    ? `Owner · ${vault.user.organization?.name ?? "Team"}`
                    : `Member · ${vault.user.organization?.name ?? "Team"}`}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm shrink-0"
              title="Profile settings"
              onClick={() => {
                setFilter("settings");
                setMobileNav(false);
              }}
            >
              <Settings size={14} />
            </button>
          </div>
        </div>
      </aside>

      {mobileNav && (
        <div
          className="backdrop md:hidden"
          onClick={() => setMobileNav(false)}
          aria-hidden
        />
      )}

      <div className="min-w-0 flex flex-col">
        <header
          className="sticky top-0 z-20 border-b hairline backdrop-blur"
          style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}
        >
          <div className="flex items-center gap-3 px-4 sm:px-6 h-14">
            <button type="button" className="btn btn-ghost btn-sm md:hidden" onClick={() => setMobileNav((v) => !v)} aria-label="Menu">
              <Menu size={18} />
            </button>
            <div className="relative flex-1 max-w-xl">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--faint)" }} />
              <input
                className="input pl-9"
                placeholder="Search logins…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search vault"
              />
            </div>
            <button type="button" className="btn btn-secondary btn-sm whitespace-nowrap" onClick={() => vault.lock()}>
              <Lock size={14} /> <span className="hidden sm:inline">Lock</span>
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 py-6 max-w-4xl w-full">
          {filter === "generator" ? (
            <GeneratorPanel onCopied={toast} />
          ) : filter === "settings" ? (
            <SettingsPanel vault={vault} toast={toast} />
          ) : filter === "admin" ? (
            <AdminPanel user={vault.user} toast={toast} vault={vault} />
          ) : (
            <>
              {isTeamUser && vault.unlocked && (
                <div
                  className="card p-4 mb-5 flex flex-wrap items-center justify-between gap-3"
                  style={{
                    borderColor: hasOrgAccess ? "color-mix(in srgb, var(--ok) 35%, var(--border))" : "var(--border)",
                  }}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">
                      {hasOrgAccess ? "Team vault is on" : "Team vault"}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                      {hasOrgAccess
                        ? "Logins under Team are shared with your project. Mine stays private."
                        : isOrgOwner
                          ? "Create one team key and share it with every ready member."
                          : "Your owner hasn’t shared the team vault yet. Ask them, then tap Refresh."}
                    </p>
                  </div>
                  {isOrgOwner && !hasOrgAccess ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={vault.busy}
                      onClick={async () => {
                        try {
                          const r = await vault.enableTeamVault();
                          setScope("org");
                          toast(
                            r.skipped > 0
                              ? `Team vault on · shared ${r.shared}, skipped ${r.skipped}`
                              : `Team vault on · shared with ${r.shared}`,
                          );
                        } catch (err) {
                          toast(err instanceof Error ? err.message : "Could not enable team vault");
                        }
                      }}
                    >
                      Turn on team vault
                    </button>
                  ) : isOrgOwner && hasOrgAccess ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={vault.busy}
                      onClick={async () => {
                        try {
                          const r = await vault.enableTeamVault();
                          toast(
                            r.skipped > 0
                              ? `Shared ${r.shared} · ${r.skipped} need vault setup first`
                              : `Shared with ${r.shared} member(s)`,
                          );
                        } catch (err) {
                          toast(err instanceof Error ? err.message : "Share failed");
                        }
                      }}
                    >
                      Share with all
                    </button>
                  ) : !isOrgOwner && !hasOrgAccess ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={vault.busy}
                      onClick={async () => {
                        await vault.refresh();
                        toast("Refreshed — if still empty, the owner hasn’t shared yet.");
                      }}
                    >
                      Refresh access
                    </button>
                  ) : null}
                </div>
              )}

              <div className="flex items-center justify-between mb-4">
                <h1 className="text-lg font-semibold tracking-tight">
                  {scope === "org" && (
                    <span className="badge badge-accent mr-2">Team</span>
                  )}
                  {filter === "all" && (scope === "org" ? "Team logins" : "My logins")}
                  {filter === "favorites" && "Favorites"}
                  {filter !== "all" && filter !== "favorites" && CATEGORY_LABELS[filter as Category]}
                  <span className="ml-2 text-sm font-normal" style={{ color: "var(--faint)" }}>
                    {filtered.length}
                  </span>
                </h1>
              </div>

              {scope === "org" && !hasOrgAccess ? (
                <div className="card p-10 text-center">
                  <Shield size={22} className="mx-auto mb-3" style={{ color: "var(--accent)" }} />
                  <h2 className="font-semibold">
                    {isOrgOwner ? "Turn on the team vault" : "Waiting for team access"}
                  </h2>
                  <p className="mt-1 text-sm max-w-md mx-auto" style={{ color: "var(--muted)" }}>
                    {isOrgOwner
                      ? "One click creates a team key on your device and shares it with members who already set up their vault. We never see the passwords."
                      : "The project owner must share the team vault with you. After they do, tap Refresh access (or lock & unlock)."}
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="card p-10 text-center">
                  <Sparkles size={22} className="mx-auto mb-3" style={{ color: "var(--accent)" }} />
                  <h2 className="font-semibold">
                    {query ? "No matches" : scope === "org" ? "No team logins yet" : "No logins yet"}
                  </h2>
                  <p className="mt-1 text-sm mb-5" style={{ color: "var(--muted)" }}>
                    {query
                      ? "Try a different search term."
                      : scope === "org"
                        ? "Everyone with team access can open these. Save shared logins like Instagram here."
                        : "Only you can open these. Passwords never leave this device unencrypted."}
                  </p>
                  {!query && (
                    <button type="button" className="btn btn-primary mx-auto" onClick={() => setEditing("new")}>
                      <Plus size={16} /> Add login
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="item-card"
                      data-selected={selectedId === item.id}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="avatar">
                        <Globe size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium text-sm truncate block">{item.name || "Untitled"}</span>
                          {item.favorite && <Star size={12} fill="var(--warn)" style={{ color: "var(--warn)" }} />}
                        </span>
                        <span className="text-xs truncate block mt-0.5" style={{ color: "var(--muted)" }}>
                          {item.username || "No username"}
                        </span>
                        <span className="text-[11px] truncate block mt-0.5 mono" style={{ color: "var(--faint)" }}>
                          {item.url || CATEGORY_LABELS[item.category as Category] || item.category}
                        </span>
                      </span>
                      {totpMap[item.id] && (
                        <span className="mono text-sm shrink-0" style={{ color: "var(--accent)" }}>
                          {totpMap[item.id].code}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {selected && !editing && (
        <>
          <div className="backdrop" onClick={() => setSelectedId(null)} />
          <ItemDrawer
            item={selected}
            totp={totpMap[selected.id]}
            onClose={() => setSelectedId(null)}
            onEdit={() => setEditing(selected)}
            onDelete={async () => {
              if (!confirm(`Delete “${selected.name}”? This cannot be undone.`)) return;
              await vault.deleteItem(selected.id, selected.scope === "org" ? "org" : "personal");
              setSelectedId(null);
              toast("Login deleted");
            }}
            onToggleFavorite={async () => {
              await vault.saveItem(
                {
                  name: selected.name,
                  username: selected.username,
                  password: selected.password,
                  url: selected.url,
                  notes: selected.notes,
                  totp: selected.totp,
                },
                {
                  id: selected.id,
                  favorite: !selected.favorite,
                  category: selected.category,
                  scope: selected.scope === "org" ? "org" : "personal",
                },
              );
              toast(selected.favorite ? "Removed from favorites" : "Added to favorites");
            }}
            toast={toast}
          />
        </>
      )}

      {editing && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          allowedCategories={allowed}
          busy={vault.busy}
          onCancel={() => setEditing(null)}
          onSave={async (data, favorite, category) => {
            await vault.saveItem(data, {
              id: editing === "new" ? undefined : editing.id,
              favorite,
              category,
              scope,
            });
            setEditing(null);
            toast(editing === "new" ? "Login saved" : "Login updated");
          }}
        />
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

function ItemDrawer({
  item,
  totp,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
  toast,
}: {
  item: DecryptedItem;
  totp?: { code: string; secondsRemaining: number };
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  toast: (m: string) => void;
}) {
  const [reveal, setReveal] = useState(false);

  async function copy(text: string | undefined, label: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`);
  }

  const rows = [
    { label: "Username", value: item.username },
    { label: "Password", value: item.password, mono: true, secret: true },
    { label: "Website", value: item.url },
    { label: "Category", value: CATEGORY_LABELS[item.category as Category] ?? item.category },
    ...(item.totp ? [{ label: "One-time code", value: totp?.code ?? "------", mono: true }] : []),
    ...(item.notes ? [{ label: "Notes", value: item.notes }] : []),
  ];

  return (
    <aside className="drawer" role="dialog" aria-label={item.name}>
      <div className="flex items-start gap-3 p-5 border-b hairline">
        <span className="avatar"><Globe size={16} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold tracking-tight truncate">{item.name || "Untitled"}</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Login</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleFavorite} aria-label="Toggle favorite">
          <Star size={16} fill={item.favorite ? "var(--warn)" : "none"} style={{ color: item.favorite ? "var(--warn)" : "var(--muted)" }} />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {rows.map((row) => {
          const isSecret = !!row.secret;
          const shown = !isSecret || reveal;
          return (
            <div key={row.label}>
              <p className="label mb-1">{row.label}</p>
              <div className="field-row">
                <span
                  className={`value ${row.mono ? "mono" : ""}`}
                  style={{
                    whiteSpace: row.label === "Notes" ? "pre-wrap" : undefined,
                  }}
                >
                  {row.value ? (shown ? row.value : "••••••••") : <span style={{ color: "var(--faint)" }}>—</span>}
                </span>
                {isSecret && row.value && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReveal((r) => !r)} aria-label="Toggle visibility">
                    {shown ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                )}
                {row.label === "One-time code" && totp && (
                  <span className="badge badge-accent mono" title={`${totp.secondsRemaining}s left`}>
                    {totp.secondsRemaining}s
                  </span>
                )}
                {row.value && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(row.value, row.label)} aria-label={`Copy ${row.label}`}>
                    <Copy size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-xs pt-2" style={{ color: "var(--faint)" }}>
          Updated {new Date(item.updatedAt).toLocaleString()}
        </p>
      </div>

      <div className="p-4 border-t hairline flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onEdit}>Edit</button>
        <button type="button" className="btn btn-danger" onClick={onDelete} aria-label="Delete item">
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  );
}

function ItemEditor({
  item,
  allowedCategories,
  busy,
  onCancel,
  onSave,
}: {
  item: DecryptedItem | null;
  allowedCategories: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (data: VaultItemData, favorite: boolean, category: string) => Promise<void>;
}) {
  const cats = (allowedCategories.length ? allowedCategories : []) as Category[];
  const [name, setName] = useState(item?.name ?? "");
  const [username, setUsername] = useState(item?.username ?? "");
  const [password, setPassword] = useState(item?.password ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [totp, setTotp] = useState(item?.totp ?? "");
  const [category, setCategory] = useState<string>(
    item?.category && cats.includes(item.category as Category)
      ? item.category
      : cats[0] ?? "",
  );
  const [favorite, setFavorite] = useState(item?.favorite ?? false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!category) {
      setError("Pick a category your admin has granted you.");
      return;
    }
    try {
      await onSave(
        {
          type: "login",
          name: name.trim() || "Untitled",
          username,
          password,
          url,
          notes,
          totp,
        },
        favorite,
        category,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  if (cats.length === 0) {
    return (
      <>
        <div className="backdrop" onClick={onCancel} />
        <div className="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none">
          <div className="card w-full max-w-sm pointer-events-auto p-6 text-center space-y-3">
            <h2 className="font-semibold tracking-tight">No categories yet</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Your admin hasn&rsquo;t granted you any login categories. Ask them to open
              Admin → Access control and turn on Work, Personal, etc. for your email.
            </p>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Close
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="backdrop" onClick={onCancel} />
      <div className="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none">
        <form
          onSubmit={submit}
          className="card w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold tracking-tight">{item ? "Edit login" : "New login"}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Cancel">
              <X size={16} />
            </button>
          </div>

          <div>
            <label className="label" htmlFor="iname">Name</label>
            <input id="iname" className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub, Gmail, Bank" />
          </div>

          <div>
            <label className="label" htmlFor="icat">Category</label>
            <select id="icat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--faint)" }}>
              Only categories your admin granted appear here.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="iuser">Username / email</label>
            <input id="iuser" className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </div>

          <div>
            <label className="label" htmlFor="ipass">Password</label>
            <div className="flex gap-2">
              <input id="ipass" className="input mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                onClick={() => {
                  import("@/lib/password").then(({ generatePassword }) =>
                    setPassword(
                      generatePassword({
                        length: 20,
                        upper: true,
                        lower: true,
                        digits: true,
                        symbols: true,
                        excludeAmbiguous: true,
                      }),
                    ),
                  );
                }}
              >
                <Wand2 size={14} /> Generate
              </button>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="iurl">Website</label>
            <input id="iurl" className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>

          <div>
            <label className="label" htmlFor="itotp">TOTP secret (base32 or otpauth://)</label>
            <input id="itotp" className="input mono" value={totp} onChange={(e) => setTotp(e.target.value)} autoComplete="off" />
          </div>

          <div>
            <label className="label" htmlFor="inotes">Notes</label>
            <textarea id="inotes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
            Add to favorites
          </label>

          {error && (
            <p className="text-sm rounded-lg px-3 py-2" style={{ color: "var(--danger)", background: "var(--danger-soft)" }} role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-secondary flex-1" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              Save login
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function SettingsPanel({
  vault,
  toast,
}: {
  vault: ReturnType<typeof useVault>;
  toast: (m: string) => void;
}) {
  const [theme, setThemeState] = useState<"system" | "dark" | "light">("system");
  const [autoLock, setAutoLockState] = useState(15);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState<{ id: string; label: string; expiresAt: string; lastUsedAt: string | null }[]>([]);
  const [passkeys, setPasskeys] = useState<{ id: string; deviceName: string; createdAt: string }[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(vault.user?.displayName ?? "");
  const [avatar, setAvatar] = useState<string | null>(vault.user?.avatar ?? null);
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    setThemeState(getThemePref());
    setAutoLockState(getAutoLockMinutes());
    setDisplayName(vault.user?.displayName ?? "");
    setAvatar(vault.user?.avatar ?? null);
    fetch("/api/settings/extension-tokens").then((r) => r.json()).then((d) => setTokens(d.tokens ?? [])).catch(() => {});
    fetch("/api/webauthn/register").then((r) => (r.ok ? r.json() : { passkeys: [] })).then((d) => setPasskeys(d.passkeys ?? [])).catch(() => {});
  }, [vault.user?.displayName, vault.user?.avatar]);

  async function onPickAvatar(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file");
      return;
    }
    if (file.size > 200 * 1024) {
      toast("Image too large — max 200KB");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    setAvatar(dataUrl);
  }

  async function saveProfile() {
    setProfileBusy(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          avatar: avatar ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save profile");
      if (vault.user) {
        vault.user.displayName = data.displayName;
        vault.user.avatar = data.avatar;
      }
      await vault.refresh();
      toast("Profile saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed");
    } finally {
      setProfileBusy(false);
    }
  }

  const roleLabel =
    vault.user?.platformRole === "superadmin"
      ? "Platform owner"
      : vault.user?.orgRole === "owner"
        ? "Project owner"
        : "Member";

  return (
    <div className="space-y-5 max-w-xl">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      <section className="card p-4 space-y-4">
        <h2 className="font-semibold text-sm">Your profile</h2>
        <div className="flex items-center gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt="Avatar"
              className="h-16 w-16 rounded-full object-cover border"
              style={{ borderColor: "var(--border)" }}
            />
          ) : (
            <span className="avatar h-16 w-16 text-lg" style={{ borderRadius: "50%" }}>
              {(displayName || vault.user?.email || "?").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="space-y-2">
            <label className="btn btn-secondary btn-sm cursor-pointer">
              Upload photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
              />
            </label>
            {avatar && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAvatar(null)}>
                Remove
              </button>
            )}
            <p className="text-xs" style={{ color: "var(--faint)" }}>JPG/PNG · max 200KB</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Display name</label>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Andi"
              maxLength={80}
            />
          </div>
          <div>
            <label className="label">Role</label>
            <input className="input" value={roleLabel} disabled />
          </div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={vault.user?.email ?? ""} disabled />
        </div>
        <div>
          <label className="label">Project</label>
          <input
            className="input"
            value={vault.user?.organization?.name ?? "—"}
            disabled
          />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={profileBusy}
          onClick={saveProfile}
        >
          {profileBusy ? <Loader2 size={14} className="animate-spin" /> : null}
          Save profile
        </button>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Appearance &amp; security</h2>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Theme</span>
          <div className="flex gap-2">
            {(["system", "dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn btn-sm ${theme === t ? "btn-primary" : "btn-secondary"}`}
                onClick={() => {
                  setTheme(t);
                  setThemeState(t);
                  toast(
                    t === "system"
                      ? "Theme follows your device"
                      : t === "dark"
                        ? "Dark theme on"
                        : "Light theme on",
                  );
                }}
              >
                {t === "system" ? "System" : t === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Auto-lock after idle</span>
          <select
            className="input w-auto"
            value={autoLock}
            onChange={(e) => {
              const v = Number(e.target.value);
              setAutoLockMinutes(v);
              setAutoLockState(v);
              toast("Auto-lock updated");
            }}
          >
            {[1, 5, 15, 30, 60].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </div>
        {vault.user?.allowedCategories && vault.user.role !== "admin" && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm">Your login categories</span>
            <span className="text-xs text-right" style={{ color: "var(--muted)" }}>
              {vault.user.allowedCategories.map((c) => CATEGORY_LABELS[c as Category] ?? c).join(", ")}
            </span>
          </div>
        )}
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Passkeys (Face ID / fingerprint)</h2>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          A passkey can unlock your vault without typing the master password. The key is derived on the authenticator via WebAuthn PRF — the server never sees it.
        </p>
        {passkeys.length > 0 && (
          <ul className="space-y-1.5">
            {passkeys.map((p) => (
              <li key={p.id} className="text-sm flex justify-between gap-2">
                <span>{p.deviceName}</span>
                <span className="text-xs" style={{ color: "var(--faint)" }}>
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={vault.busy}
          onClick={async () => {
            try {
              await vault.enrollPasskey("Device passkey");
              toast("Passkey enrolled");
            } catch (err) {
              toast(err instanceof Error ? err.message : "Passkey setup failed");
            }
          }}
        >
          <Sparkles size={15} /> Add passkey
        </button>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Change master password</h2>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Re-encrypts your vault key under a new password. Existing passkey unlocks keep working.
        </p>
        <div>
          <label className="label">Current master password</label>
          <input className="input mono" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className="label">New master password</label>
          <input className="input mono" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !oldPw || newPw.length < 10}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              await vault.changeMaster(oldPw, newPw);
              setOldPw("");
              setNewPw("");
              toast("Master password changed");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Change failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Update master password
        </button>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Browser extension token</h2>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Create a token, paste it into the Keyring extension, then unlock with your master password inside the extension. Tokens only fetch encrypted data.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => {
            const res = await fetch("/api/settings/extension-tokens", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: "Browser extension" }),
            });
            const data = await res.json();
            if (!res.ok) { toast(data.error || "Could not create token"); return; }
            setNewToken(data.token);
            const list = await fetch("/api/settings/extension-tokens").then((r) => r.json());
            setTokens(list.tokens ?? []);
            toast("Token created — copy it now");
          }}
        >
          Create extension token
        </button>
        {newToken && (
          <div className="field-row">
            <span className="value mono text-xs">{newToken}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(newToken);
                toast("Token copied");
              }}
            >
              <Copy size={14} /> Copy
            </button>
          </div>
        )}
        {tokens.length > 0 && (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{t.label}</p>
                  <p className="text-xs" style={{ color: "var(--faint)" }}>
                    Expires {new Date(t.expiresAt).toLocaleDateString()}
                    {t.lastUsedAt ? ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    await fetch("/api/settings/extension-tokens", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: t.id }),
                    });
                    setTokens((xs) => xs.filter((x) => x.id !== t.id));
                    toast("Token revoked");
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AdminPanel({
  user,
  toast,
  vault,
}: {
  user: NonNullable<ReturnType<typeof useVault>["user"]>;
  toast: (m: string) => void;
  vault: ReturnType<typeof useVault>;
}) {
  const isPlatform = user.platformRole === "superadmin";
  return isPlatform ? (
    <PlatformPanel toast={toast} />
  ) : (
    <OrgPanel user={user} toast={toast} vault={vault} />
  );
}

type OrgUserRow = {
  id: string;
  email: string;
  role: string;
  orgRole: string | null;
  platformRole: string;
  status: string;
  allowedCategories: string[];
  organizationId: string | null;
  organization: { id: string; name: string; slug: string } | null;
  createdAt: string;
  itemCount: number;
  passkeyCount: number;
};

/** SaaS owner view — structure only, never passwords. */
function PlatformPanel({ toast }: { toast: (m: string) => void }) {
  type OrgCard = {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
    itemCount: number;
    passkeyCount: number;
    owners: { id: string; email: string; status: string; itemCount: number; passkeyCount: number }[];
    members: { id: string; email: string; status: string; itemCount: number; passkeyCount: number }[];
  };
  const [orgs, setOrgs] = useState<OrgCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<OrgCard | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/platform/organizations");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not load organizations.");
      setLoading(false);
      return;
    }
    setOrgs(data.organizations);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Platform</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            All customer projects. You see structure and counts only — vault secrets stay encrypted on each user&rsquo;s device (zero-knowledge).
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus size={14} /> New project
        </button>
      </div>

      {showCreate && (
        <form
          className="card p-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await fetch("/api/platform/organizations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                ownerEmail,
                ownerPassword: ownerPassword || undefined,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              toast(data.error || "Create failed");
              return;
            }
            toast("Project created");
            setShowCreate(false);
            setName("");
            setOwnerEmail("");
            setOwnerPassword("");
            load();
          }}
        >
          <div>
            <label className="label">Project name</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Studio" />
          </div>
          <div>
            <label className="label">Owner email</label>
            <input className="input" type="email" required value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Owner password (only if email is new)</label>
            <input className="input mono" type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} placeholder="Min 10 chars" />
            <p className="mt-1 text-xs" style={{ color: "var(--faint)" }}>
              Hashed with scrypt on our side for login only. We never receive this user&rsquo;s vault master password.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm">Create project</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </form>
      )}

      {error && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ color: "var(--danger)", background: "var(--danger-soft)" }}>{error}</p>
      )}

      {loading ? (
        <div className="card p-8 grid place-items-center" style={{ color: "var(--muted)" }}>
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : orgs.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--muted)" }}>
          No projects yet. Create one to invite your first customer owner.
        </div>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => (
            <div key={org.id} className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{org.name}</p>
                  <p className="text-xs mono" style={{ color: "var(--faint)" }}>
                    {org.slug} · {org.itemCount} items · {org.passkeyCount} passkeys
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge ${org.status === "active" ? "badge-ok" : "badge-danger"}`}>{org.status}</span>
                  <button
                    type="button"
                    className={`btn btn-sm ${org.status === "active" ? "btn-secondary" : "btn-secondary"}`}
                    onClick={async () => {
                      const res = await fetch("/api/platform/organizations", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          organizationId: org.id,
                          status: org.status === "active" ? "suspended" : "active",
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) toast(data.error || "Update failed");
                      else toast(org.status === "active" ? "Project suspended" : "Project restored");
                      load();
                    }}
                  >
                    {org.status === "active" ? "Suspend" : "Restore"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      setDeleteTarget(org);
                      setDeleteConfirm("");
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div>
                <p className="label">Owners</p>
                {org.owners.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--faint)" }}>No owner</p>
                ) : (
                  <ul className="space-y-1">
                    {org.owners.map((o) => (
                      <li key={o.id} className="text-sm flex flex-wrap justify-between gap-2">
                        <span>{o.email}</span>
                        <span className="text-xs" style={{ color: "var(--faint)" }}>
                          {o.itemCount} items · {o.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="label">Members ({org.members.length})</p>
                {org.members.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--faint)" }}>No members yet</p>
                ) : (
                  <ul className="space-y-1">
                    {org.members.map((m) => (
                      <li key={m.id} className="text-sm flex flex-wrap justify-between gap-2">
                        <span>{m.email}</span>
                        <span className="text-xs" style={{ color: "var(--faint)" }}>
                          {m.itemCount} items · {m.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <>
          <div className="backdrop" onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); }} />
          <div className="fixed inset-0 z-50 grid place-items-center p-4 pointer-events-none">
            <div className="card w-full max-w-md pointer-events-auto p-5 space-y-4">
              <h2 className="font-semibold tracking-tight">Delete project permanently?</h2>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                This removes <strong>{deleteTarget.name}</strong>, all owners/members, team vault items,
                and personal vault ciphertext. Cannot be undone.
              </p>
              <div>
                <label className="label">
                  Type <span className="mono">{deleteTarget.name}</span> to confirm
                </label>
                <input
                  className="input"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder={deleteTarget.name}
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setDeleteTarget(null); setDeleteConfirm(""); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={deleteConfirm.trim() !== deleteTarget.name.trim()}
                  onClick={async () => {
                    const res = await fetch("/api/platform/organizations", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        organizationId: deleteTarget.id,
                        confirmName: deleteTarget.name,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      toast(data.error || "Delete failed");
                      return;
                    }
                    toast(`Deleted “${deleteTarget.name}”`);
                    setDeleteTarget(null);
                    setDeleteConfirm("");
                    load();
                  }}
                >
                  Delete forever
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Org owner view — manage members under this project. */
function OrgPanel({
  user,
  toast,
  vault,
}: {
  user: NonNullable<ReturnType<typeof useVault>["user"]>;
  toast: (m: string) => void;
  vault: ReturnType<typeof useVault>;
}) {
  const [users, setUsers] = useState<OrgUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteCats, setInviteCats] = useState<string[]>(["personal", "social"]);
  const [memberKeys, setMemberKeys] = useState<
    { id: string; email: string; publicKey: string | null; hasVaultKeys: boolean }[]
  >([]);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not load users.");
      setLoading(false);
      return;
    }
    setUsers(data.users);
    setLoading(false);
  };

  const loadKeys = async () => {
    const res = await fetch("/api/org/members/keys");
    if (res.ok) {
      const data = await res.json();
      setMemberKeys(data.members ?? []);
    }
  };

  useEffect(() => {
    load();
    loadKeys();
  }, []);

  async function patch(userId: string, body: Record<string, unknown>) {
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...body }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || "Update failed");
      return;
    }
    toast("User updated");
    load();
  }

  function toggleCategory(u: OrgUserRow, cat: string) {
    const next = u.allowedCategories.includes(cat)
      ? u.allowedCategories.filter((c) => c !== cat)
      : [...u.allowedCategories, cat];
    patch(u.id, { allowedCategories: next });
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Team{user.organization ? ` · ${user.organization.name}` : ""}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Invite people, set categories, and share the team vault in one place.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">Team vault</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            Creates a team key on your device and shares it with members who already unlocked their vault.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={vault.busy}
          onClick={async () => {
            try {
              const r = await vault.enableTeamVault();
              toast(
                r.skipped > 0
                  ? `Shared ${r.shared} · ${r.skipped} still need to unlock their vault once`
                  : `Shared with ${r.shared} member(s)`,
              );
              loadKeys();
            } catch (err) {
              toast(err instanceof Error ? err.message : "Could not enable team vault");
            }
          }}
        >
          {vault.hasOrgKey ? "Share with all members" : "Turn on team vault"}
        </button>
      </div>

      <form
        className="card p-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await fetch("/api/admin/invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: inviteEmail,
              password: invitePassword,
              allowedCategories: inviteCats.length ? inviteCats : ["personal"],
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast(data.error || "Invite failed");
            return;
          }
          toast("Member added · categories: " + (data.categories || inviteCats.join(", ")));
          setInviteEmail("");
          setInvitePassword("");
          load();
          loadKeys();
        }}
      >
        <p className="font-semibold text-sm">Add teammate</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          They get a sign-in account. Categories decide which login folders they can use.
          Shared logins must live under <strong>Team vault</strong> (not Mine), then use Share vault.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Temp password</label>
            <input className="input mono" type="password" required minLength={10} value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
          </div>
        </div>
        <div>
          <p className="label">Categories they can use</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => {
              const on = inviteCats.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  className={`btn btn-sm ${on ? "btn-primary" : "btn-secondary"}`}
                  onClick={() =>
                    setInviteCats((xs) =>
                      xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c],
                    )
                  }
                >
                  {CATEGORY_LABELS[c]}
                </button>
              );
            })}
          </div>
        </div>
        <button type="submit" className="btn btn-secondary btn-sm">Add member</button>
      </form>

      {error && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ color: "var(--danger)", background: "var(--danger-soft)" }}>{error}</p>
      )}

      <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
        {loading ? (
          <div className="p-8 grid place-items-center" style={{ color: "var(--muted)" }}>
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : users.length === 0 ? (
          <p className="p-8 text-sm text-center" style={{ color: "var(--muted)" }}>No users in this project.</p>
        ) : (
          users.map((u) => (
            <div key={u.id} className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{u.email}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--faint)" }}>
                    {u.itemCount} items · {u.passkeyCount} passkeys ·{" "}
                    {u.orgRole === "owner" ? "owner" : "member"} · joined {new Date(u.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge ${u.status === "active" ? "badge-ok" : "badge-danger"}`}>{u.status}</span>
                  <button
                    type="button"
                    className={`btn btn-sm ${u.status === "active" ? "btn-danger" : "btn-secondary"}`}
                    onClick={() => patch(u.id, { status: u.status === "active" ? "revoked" : "active" })}
                  >
                    {u.status === "active" ? "Revoke" : "Restore"}
                  </button>
                </div>
              </div>

              {u.platformRole !== "superadmin" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label mb-0">Role</span>
                  {(["owner", "member"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`btn btn-sm ${(u.orgRole ?? "member") === r ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => patch(u.id, { orgRole: r })}
                    >
                      {r}
                    </button>
                  ))}
                  {u.id !== user.id && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={vault.busy || !vault.hasOrgKey}
                      onClick={async () => {
                        try {
                          await vault.shareOrgKeyWithMember(u.id);
                          toast("Shared vault key sent to member");
                          loadKeys();
                        } catch (err) {
                          toast(err instanceof Error ? err.message : "Share failed");
                        }
                      }}
                    >
                      Share vault
                    </button>
                  )}
                  {u.platformRole !== "superadmin" && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={async () => {
                        if (!confirm(`Reset sign-in password for ${u.email}? They stay signed out.`)) return;
                        const res = await fetch("/api/admin/reset-password", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ userId: u.id }),
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          toast(data.error || "Reset failed");
                          return;
                        }
                        toast(`Temp password: ${data.temporaryPassword}`);
                        alert(
                          `Temporary sign-in password for ${data.email}:\n\n${data.temporaryPassword}\n\nCopy it now — shown once. Share out-of-band. Does not change vault master password.`,
                        );
                      }}
                    >
                      Reset password
                    </button>
                  )}
                  {(() => {
                    const mk = memberKeys.find((m) => m.id === u.id);
                    if (!mk) return null;
                    if (!mk.hasVaultKeys) {
                      return (
                        <span className="badge" title="They must unlock their vault once with master password">
                          needs vault setup
                        </span>
                      );
                    }
                    return <span className="badge badge-ok">keys ready</span>;
                  })()}
                </div>
              )}

              {u.orgRole !== "owner" && u.platformRole !== "superadmin" ? (
                <div>
                  <p className="label">Login categories</p>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => {
                      const on = u.allowedCategories.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          className={`btn btn-sm ${on ? "btn-primary" : "btn-secondary"}`}
                          onClick={() => toggleCategory(u, c)}
                          aria-pressed={on}
                        >
                          {CATEGORY_LABELS[c]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--faint)" }}>
                  Owners always have every category.
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
