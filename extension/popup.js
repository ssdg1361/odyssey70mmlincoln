const $ = (id) => document.getElementById(id);
const defaults = { publishUrl: "https://odyssey70mmlincoln.sjs05k.workers.dev/api/collector/publish", intervalMinutes: 60 };
async function refresh() { const values = await chrome.storage.local.get(["publishUrl", "token", "intervalMinutes", "monitorStatus"]); $("url").value = values.publishUrl || defaults.publishUrl; $("token").value = values.token || ""; $("interval").value = String(values.intervalMinutes || 60); const status = values.monitorStatus || { state: "needs_setup", message: "Add settings to begin." }; $("status").textContent = `${status.state.replaceAll("_", " ")}: ${status.message || ""}${status.progress ? `\n${status.progress}` : ""}${status.updatedAt ? `\n${new Date(status.updatedAt).toLocaleString()}` : ""}`; }
$("save").onclick = () => chrome.runtime.sendMessage({ type: "save_settings", settings: { publishUrl: $("url").value.trim(), token: $("token").value.trim(), intervalMinutes: Number($("interval").value) } }, refresh);
$("run").onclick = () => { $("status").textContent = "running: opening AMC…"; chrome.runtime.sendMessage({ type: "run_now" }, () => setTimeout(refresh, 1000)); };
refresh();
