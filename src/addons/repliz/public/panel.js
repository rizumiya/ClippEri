export async function mount(container, { api, toast }) {
    const today = new Date().toISOString().split("T")[0];
    container.querySelectorAll('input[type="date"]').forEach((el) => {
        if (!el.value) el.value = today;
    });

    let accounts = [];

    async function refresh() {
        const [cfg, accList] = await Promise.all([
            api.get("/api/addons/repliz/settings"),
            api.get("/api/addons/repliz/accounts")
        ]);
        accounts = Array.isArray(accList) ? accList : [];

        container.querySelector("#repliz-access-key").value = cfg.access_key || "";
        container.querySelector("#repliz-secret-key").value = cfg.secret_key || "";
        container.querySelector("#repliz-webhook-url").value = cfg.upload_webhook_url || "";
        container.querySelector("#repliz-public-base").value = cfg.upload_public_base_url || "";
        container.querySelector("#repliz-sheet-webhook").value = cfg.spreadsheet_webhook_url || "";

        renderAccounts();
    }

    function renderAccounts() {
        const picker = container.querySelector("#repliz-account-picker");
        const list = container.querySelector("#repliz-accounts-table");

        if (accounts.length === 0) {
            picker.innerHTML = `<span class="muted">Belum ada akun Repliz. Tambahkan di tab Akun & Kredensial.</span>`;
            list.innerHTML = `<p class="muted">Belum ada akun terdaftar.</p>`;
            return;
        }

        picker.innerHTML = accounts.map((a) => `
            <label class="check-chip">
                <input type="checkbox" value="${a.id}" checked>
                <span>${a.name || a.id}</span>
            </label>
        `).join("");

        list.innerHTML = accounts.map((a, idx) => `
            <div class="list-row">
                <div>
                    <strong>${a.name || "Tanpa Nama"}</strong>
                    <div class="muted mono">${a.id}</div>
                </div>
                <button type="button" class="btn-danger-ghost" data-del="${idx}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join("");

        list.querySelectorAll("[data-del]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const idx = Number(btn.dataset.del);
                accounts.splice(idx, 1);
                await api.post("/api/addons/repliz/accounts", accounts);
                toast("Akun dihapus.");
                renderAccounts();
            });
        });
    }

    // Tab switching
    container.querySelectorAll("#repliz-tabs .tab-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            container.querySelectorAll("#repliz-tabs .tab-pill").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const tab = btn.dataset.rtab;
            container.querySelector("#repliz-tab-upload").style.display = tab === "upload" ? "" : "none";
            container.querySelector("#repliz-tab-accounts").style.display = tab === "accounts" ? "" : "none";
        });
    });

    // Schedule mode switch
    const schedSelect = container.querySelector("#repliz-schedule-mode");
    schedSelect.addEventListener("change", () => {
        const val = schedSelect.value;
        container.querySelector("#repliz-sched-fixed").style.display = val === "fixed" ? "" : "none";
        container.querySelector("#repliz-sched-range").style.display = val === "range" ? "" : "none";
        container.querySelector("#repliz-sched-list").style.display = val === "list" ? "" : "none";
    });

    // Submit batch upload
    container.querySelector("#repliz-upload-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const d = Object.fromEntries(fd.entries());
        const selected = Array.from(container.querySelectorAll("#repliz-account-picker input:checked")).map((i) => i.value);
        if (selected.length === 0) {
            toast("Pilih minimal 1 akun Repliz.", "error");
            return;
        }

        const scheduleMode = d.scheduleMode || "fixed";
        let scheduleTimes = [];
        const parseDateTime = (dateStr, timeStr) => {
            const dt = dateStr || today;
            const tm = String(timeStr || "13:00").trim().replace(".", ":");
            return new Date(`${dt}T${tm}:00`);
        };

        if (scheduleMode === "fixed") {
            const dt = parseDateTime(d.fixedDate, d.fixedTime);
            for (let i = 0; i < 50; i++) scheduleTimes.push(dt.toISOString());
        } else if (scheduleMode === "list") {
            const list = String(d.listTimes || "").split(",").map((s) => s.trim()).filter(Boolean);
            scheduleTimes = list.map((t) => parseDateTime(d.listDate, t).toISOString());
        }

        await api.run("/api/addons/repliz/upload", {
            uploadDir: d.uploadDir,
            scheduleSettings: {
                scheduleMode,
                scheduleTimes,
                selectedReplizAccountIds: selected,
                rangeStartDate: d.rangeStartDate || "",
                rangeEndDate: d.rangeEndDate || "",
                rangeStart: d.rangeStart || "",
                rangeEnd: d.rangeEnd || ""
            }
        });
    });

    // Save settings
    container.querySelector("#repliz-settings-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        await api.post("/api/addons/repliz/settings", {
            access_key: container.querySelector("#repliz-access-key").value,
            secret_key: container.querySelector("#repliz-secret-key").value,
            upload_webhook_url: container.querySelector("#repliz-webhook-url").value,
            upload_public_base_url: container.querySelector("#repliz-public-base").value,
            spreadsheet_webhook_url: container.querySelector("#repliz-sheet-webhook").value
        });
        toast("Pengaturan Repliz disimpan.");
    });

    // Add account
    container.querySelector("#repliz-add-acc-btn").addEventListener("click", async () => {
        const nameEl = container.querySelector("#repliz-new-acc-name");
        const idEl = container.querySelector("#repliz-new-acc-id");
        const name = nameEl.value.trim();
        const id = idEl.value.trim();
        if (!id) {
            toast("Account ID wajib diisi.", "error");
            return;
        }
        accounts.push({ name: name || id, id });
        await api.post("/api/addons/repliz/accounts", accounts);
        nameEl.value = "";
        idEl.value = "";
        toast("Akun Repliz ditambahkan.");
        renderAccounts();
    });

    await refresh();
}
