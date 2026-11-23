export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatRelativeTime(ms: number | null | undefined): string {
  if (!ms) return "never";
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (Math.abs(diffSec) < 5) return "just now";
  const future = diffSec < 0;
  const abs = Math.abs(diffSec);
  let label: string;
  if (abs < 60) label = `${abs}s`;
  else if (abs < 3600) label = `${Math.floor(abs / 60)}m`;
  else if (abs < 86400) label = `${Math.floor(abs / 3600)}h`;
  else label = `${Math.floor(abs / 86400)}d`;
  return future ? `in ${label}` : `${label} ago`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusBadge(status: string): string {
  const safe = escapeHtml(status);
  return `<span class="badge badge-${safe}">${safe}</span>`;
}

interface LayoutOptions {
  title: string;
  activeNav?: "rooms" | "machines" | "device";
  user: string;
  devMode?: boolean;
  body: string;
}

export function renderPage(opts: LayoutOptions): string {
  const navLink = (href: string, label: string, key: LayoutOptions["activeNav"]) =>
    `<a href="${href}" class="${opts.activeNav === key ? "active" : ""}">${label}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)} — tasks</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #fafafa;
      --card: #ffffff;
      --fg: #18181b;
      --muted: #71717a;
      --border: #e4e4e7;
      --accent: #2563eb;
      --accent-fg: #ffffff;
      --danger: #dc2626;
      --code-bg: #f4f4f5;
      --open-bg: #dcfce7; --open-fg: #166534;
      --waiting-bg: #fef9c3; --waiting-fg: #854d0e;
      --blocked-bg: #fee2e2; --blocked-fg: #991b1b;
      --done-bg: #e4e4e7; --done-fg: #3f3f46;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #09090b;
        --card: #121215;
        --fg: #f4f4f5;
        --muted: #a1a1aa;
        --border: #27272a;
        --accent: #3b82f6;
        --accent-fg: #ffffff;
        --danger: #ef4444;
        --code-bg: #1c1c21;
        --open-bg: #052e16; --open-fg: #86efac;
        --waiting-bg: #422006; --waiting-fg: #fde047;
        --blocked-bg: #450a0a; --blocked-fg: #fca5a5;
        --done-bg: #27272a; --done-fg: #a1a1aa;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, pre, .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.9em;
    }
    header {
      border-bottom: 1px solid var(--border);
      background: var(--card);
    }
    .header-inner, main {
      max-width: 900px;
      margin: 0 auto;
      padding: 0 16px;
    }
    .header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 54px;
      gap: 16px;
    }
    .brand {
      font-weight: 700;
      color: var(--fg);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 1rem;
    }
    nav { display: flex; gap: 16px; align-items: center; }
    nav a { color: var(--muted); font-size: 0.9rem; font-weight: 500; }
    nav a.active, nav a:hover { color: var(--fg); text-decoration: none; }
    .user { color: var(--muted); font-size: 0.82rem; }
    main { padding-top: 24px; padding-bottom: 48px; }
    .banner {
      background: var(--waiting-bg);
      color: var(--waiting-fg);
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 16px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .stack { display: flex; flex-direction: column; gap: 12px; }
    h1 { font-size: 1.35rem; margin: 0 0 12px; }
    h2 { font-size: 1.05rem; margin: 0 0 10px; }
    .muted { color: var(--muted); font-size: 0.86rem; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: lowercase;
    }
    .badge-open { background: var(--open-bg); color: var(--open-fg); }
    .badge-waiting { background: var(--waiting-bg); color: var(--waiting-fg); }
    .badge-blocked { background: var(--blocked-bg); color: var(--blocked-fg); }
    .badge-done { background: var(--done-bg); color: var(--done-fg); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
    th { color: var(--muted); font-weight: 500; font-size: 0.8rem; }
    tr:last-child td { border-bottom: none; }
    input[type="text"], textarea, select {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--fg);
      font: inherit;
    }
    textarea { min-height: 84px; resize: vertical; }
    button, .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--fg);
      font: inherit;
      font-size: 0.88rem;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover, .btn:hover { opacity: 0.9; text-decoration: none; }
    .btn-primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
    .btn-danger { background: transparent; color: var(--danger); border-color: var(--danger); }
    .msg {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      background: var(--card);
    }
    .msg-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 0.84rem;
    }
    .msg-body { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 0.94rem; }
    .att-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .att-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 0.8rem;
      color: var(--fg);
    }
    .inline-form { display: inline; }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div style="display:flex;align-items:center;gap:20px;">
        <a href="/ui" class="brand">tasks</a>
        <nav>
          ${navLink("/ui", "Rooms", "rooms")}
          ${navLink("/ui/machines", "Machines", "machines")}
        </nav>
      </div>
      <div class="user">${escapeHtml(opts.user)}</div>
    </div>
  </header>
  <main>
    ${opts.devMode ? `<div class="banner">Local dev mode: Cloudflare Access check bypassed (ALLOW_UNAUTHENTICATED_UI=true).</div>` : ""}
    ${opts.body}
  </main>
</body>
</html>`;
}
