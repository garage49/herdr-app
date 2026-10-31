// A box under a pane's terminal to write a whole message in, then send it
// in one piece: `hc send` (paste, then Enter), the way an agent sends one, so
// it never interleaves with what an agent sends. A layout puts it in its
// pane frame's `footer`; it draws nothing until `compose.open` (a key) shows
// it under the focused pane. Enter sends, Shift+Enter is a new line, Esc
// puts it away (the draft stays, per terminal). Props from the app:
// { pane, terminal }.

import { View, div } from "gpui-kit";
import { TextareaState, Textarea } from "gpui-base";
import { hc, run, props, theme, focused, notify, nextCommand, shared, setShared } from "herdr";

function drafts() {
  const d = shared("compose.drafts");
  return d && typeof d === "object" ? { ...d } : {};
}

export default class Compose extends View {
  init(_props, cx) {
    this.shown = false;
    this.sending = false;
    const t = props()?.terminal;
    this.text = (t && drafts()[t]) || "";
    this.ta = TextareaState.new({ placeholder: "Message… Enter sends, Shift+Enter for a new line, Esc closes", value: this.text });
    this.ta.set_auto_grow(1, 8);
    this.prev = this.text;
    this.ta.on("change", (_e, cx) => { this.prev = this.text; this.text = this.ta.value(); this.keep(); cx.notify(); });
    // The textarea puts a newline in on any Enter, then says so: Shift+Enter
    // keeps its newline; a plain Enter sends the text as it was before it.
    this.ta.on("submit", (e, cx) => { if (e?.shift || e?.secondary) return; this.send(cx); });
    this.handle = cx.focus_handle();
    // compose.open / close / toggle reach every pane's copy: the focused pane's answers.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const mine = focused()?.pane === props()?.pane;
        if (c === "open" && mine && !this.shown) this.show(cx);
        else if (c === "toggle" && mine) { if (this.shown) this.hide(cx); else this.show(cx); }
        else if (c === "close" && this.shown) this.hide(cx);
      }
    });
  }

  show(cx) {
    if (!props()?.terminal) return;
    this.shown = true;
    this.ta.focus();
    cx.timer.after(100, () => this.ta.focus());
    cx.notify();
  }

  // Back to nothing; the keyboard goes back to the terminal.
  hide(cx) {
    this.keep();
    this.shown = false;
    run("pane.focus", { pane: props().pane });
    cx.notify();
  }

  // Saves the draft for this terminal (empty: forgets it).
  keep() {
    const t = props()?.terminal;
    if (!t) return;
    const d = drafts();
    if (this.text.trim()) d[t] = this.text; else delete d[t];
    setShared("compose.drafts", d);
  }

  // The text before the newline that this Enter put in (wherever the cursor was).
  typed() {
    const { prev, text } = this;
    if (text.length !== prev.length + 1) return text;
    let i = 0;
    while (i < prev.length && prev[i] === text[i]) i++;
    return text[i] === "\n" && text.slice(0, i) + text.slice(i + 1) === prev ? prev : text;
  }

  // `hc send` on the terminal's own machine: the receiving core tags a caller
  // from another machine as an agent (<hc from="…">); a local one is not.
  async send(cx) {
    const terminal = props()?.terminal;
    const text = this.typed().replace(/[\r\n]+$/, "");
    if (!text.trim()) { this.text = ""; this.ta.set_value(""); return; }
    if (!terminal) return;
    const slash = terminal.indexOf("/");
    const args = slash > 0
      ? ["exec", "--on", terminal.slice(0, slash), "--", "hc", "send", "--json", terminal.slice(slash + 1), text]
      : ["send", "--json", terminal, text];
    this.sending = true;
    cx.notify();
    const r = await hc(args).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
    this.sending = false;
    if (r.code !== 0) {
      let why = (r.stderr || r.stdout).trim();
      try { why = JSON.parse(why).error?.message ?? why; } catch {}
      notify({ title: `Not sent to ${terminal}`, body: why, level: "error" });
      cx.notify();
      return;
    }
    this.text = "";
    this.ta.set_value("");
    this.hide(cx);
  }

  // Only the text under a separator line: no title line, no buttons, no box.
  // It sits under the terminal in the same colors, with the terminal's own side padding.
  render(cx) {
    if (!this.shown) return div();
    const t = theme();
    return div().id(`compose-${props()?.pane}`).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.hide(cx); cx.stop_propagation(); } })
      .w_full().min_h(0).px(14).pt(6).pb(8).border_t(1).border_color(t.border).bg(t.background).text_color(t.foreground)
      .child(Textarea.new(this.ta).w_full().text_size(13).text_color(t.foreground));
  }
}
