export function wakePhrases(name: string) {
  const value = name.trim() || "Alex";
  return { wake_phrase: `Hey ${value}`, sleep_phrase: `Thanks ${value}` };
}
