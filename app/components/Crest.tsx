const CREST_COLORS = ["#c6ff3d", "#9a85ff", "#ff7a52", "#3de0e0", "#ffc83d", "#ff8fb1", "#7ee787", "#6ea8ff"];

function crestColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CREST_COLORS[h % CREST_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return letters.toUpperCase();
}

/** A small coloured badge with the entrant's initials. The colour comes from the name, so it is the same everywhere. */
export default function Crest({ name, size = "md" }: { name: string; size?: "xs" | "sm" | "md" }) {
  const color = crestColor(name);
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center font-display font-bold ${
        size === "xs" ? "size-6 rounded-md text-[11px]" : size === "sm" ? "size-8 rounded-lg text-sm" : "size-10 rounded-lg text-base"
      }`}
      style={{ color, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}55` }}
    >
      {initials(name)}
    </span>
  );
}
