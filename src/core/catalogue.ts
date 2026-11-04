export interface OnlineEntry {
  id: string;
  title: string;
  artist: string;
  version: string;
  format: string;
  source: string;
  license: string;
  licenseUrl: string;
  url: string;
  filename: string;
}
export const ONLINE_CATALOGUE: OnlineEntry[] = [
  {
    id: "mutopia-75",
    title: "Menuett G-Dur",
    artist: "Christian Petzold (historisch J. S. Bach)",
    version: "BWV Anh. 114 · Allen Garvin",
    format: "MIDI",
    source: "Mutopia Project",
    license: "Public Domain",
    licenseUrl: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=75",
    url: "https://www.mutopiaproject.org/ftp/BachJS/BWVAnh114/anna-magdalena-04/anna-magdalena-04.mid",
    filename: "anna-magdalena-04.mid",
  },
  {
    id: "mutopia-1612",
    title: "Menuett a-Moll",
    artist: "J. S. Bach (Zuschreibung)",
    version: "BWV Anh. 120 · Steven McDougall",
    format: "MIDI",
    source: "Mutopia Project",
    license: "Public Domain",
    licenseUrl: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1612",
    url: "https://www.mutopiaproject.org/ftp/BachJS/BWVAnh120/BWV-120/BWV-120.mid",
    filename: "BWV-120.mid",
  },
  {
    id: "mutopia-1613",
    title: "Menuett c-Moll",
    artist: "J. S. Bach (Zuschreibung)",
    version: "BWV Anh. 121 · Steven McDougall",
    format: "MIDI",
    source: "Mutopia Project",
    license: "Public Domain",
    licenseUrl: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1613",
    url: "https://www.mutopiaproject.org/ftp/BachJS/BWVAnh121/BWV-121/BWV-121.mid",
    filename: "BWV-121.mid",
  },
];
export const searchText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de")
    .replace(/ß/g, "ss");
export function matches(
  query: string,
  entry: { title: string; artist: string; version: string },
) {
  const haystack = searchText(
    `${entry.title} ${entry.artist} ${entry.version}`,
  );
  return searchText(query)
    .trim()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
