
from pathlib import Path

p = Path("shuttle.js")
s = p.read_text(encoding="utf-8")

def replace_once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f"{label}: anchor not found")
    s = s.replace(old, new, 1)

replace_once(
'''      riders: [],
      guardians: [],''',
'''      riders: [],
      riderQueryRequired: false,
      riderSearchPerformed: false,
      guardians: [],''',
"initial rider state"
)

replace_once(
'''      riders: [],
      guardians: [],
      guardianLinks: [],''',
'''      riders: [],
      riderQueryRequired: false,
      riderSearchPerformed: false,
      guardians: [],
      guardianLinks: [],''',
"cleared rider state"
)

replace_once(
'''    } else if (action === "clear-rider-search") {
      const input = document.getElementById("rider-search");
      if (input) input.value = "";
      await loadRiders("");
      renderRiders();
    } else if (action === "show-section") {''',
'''    } else if (action === "show-all-riders") {
      const input = document.getElementById("rider-search");
      if (input) input.value = "";
      await loadRiders("", true);
      renderRiders();
    } else if (action === "clear-rider-search") {
      const input = document.getElementById("rider-search");
      if (input) input.value = "";
      await loadRiders("", false);
      renderRiders();
    } else if (action === "show-section") {''',
"rider actions"
)

s = s.replace(
'''          loadRiders(""),
          loadGuardians(),''',
'''          loadRiders("", true),
          loadGuardians(),'''
)
s = s.replace(
'''loadSchedules(), loadLocations(), loadRiders("")''',
'''loadSchedules(), loadLocations(), loadRiders("", true)'''
)
s = s.replace(
'''loadChanges(), loadRiders("")''',
'''loadChanges(), loadRiders("", true)'''
)

replace_once(
'''  async function loadRiders(search = "") {
    const suffix = search ? `?query=${encodeURIComponent(search)}&limit=100` : "?limit=100";
    const result = await api(`/v1/riders${suffix}`);
    state.data.riders = result.riders || [];
  }''',
'''  async function loadRiders(search = "", explicitAll = false) {
    const normalized = String(search || "").trim();
    const suffix = normalized
      ? `?query=${encodeURIComponent(normalized)}&limit=100`
      : explicitAll
        ? "?all=1&limit=100"
        : "?limit=100";
    const result = await api(`/v1/riders${suffix}`);
    state.data.riders = result.riders || [];
    state.data.riderQueryRequired = result.queryRequired === true;
    state.data.riderSearchPerformed = Boolean(normalized) || explicitAll;
  }''',
"loadRiders"
)

replace_once(
'''            <button type="button" class="button" data-action="search-riders">検索</button>
            <button type="button" class="button button-secondary" data-action="clear-rider-search">クリア</button>''',
'''            <button type="button" class="button" data-action="search-riders">検索</button>
            <button type="button" class="button button-secondary" data-action="show-all-riders">全件表示</button>
            <button type="button" class="button button-secondary" data-action="clear-rider-search">クリア</button>''',
"rider search buttons"
)

replace_once(
'''        ${riders.length ? renderRidersTable(riders) : emptyState("♙", "患者が登録されていません", "最初に送迎を利用する方の基本情報を登録してください。医療・健康情報は必要最小限だけ入力します。", '<button type="button" class="button" data-action="open-rider-form">患者を登録</button>')}''',
'''        ${riders.length
          ? renderRidersTable(riders)
          : state.data.riderQueryRequired
            ? emptyState(
                "♙",
                "患者を検索してください",
                "氏名・電話番号・患者番号で検索するか、「全件表示」で最大100件まで表示できます。",
                '<button type="button" class="button button-secondary" data-action="show-all-riders">全件表示</button>'
              )
            : state.data.riderSearchPerformed
              ? emptyState(
                  "♙",
                  "該当する患者はいません",
                  "検索条件を変更するか、クリアしてもう一度お試しください。",
                  '<button type="button" class="button button-secondary" data-action="clear-rider-search">検索をクリア</button>'
                )
              : emptyState(
                  "♙",
                  "患者が登録されていません",
                  "最初に送迎を利用する方の基本情報を登録してください。医療・健康情報は必要最小限だけ入力します。",
                  '<button type="button" class="button" data-action="open-rider-form">患者を登録</button>'
                )}''',
"rider empty state"
)

s = s.replace(
'''    await loadRiders("");
    renderRiders();
    showToast(`${body.fullName}さんを登録しました。`);''',
'''    await loadRiders("", true);
    renderRiders();
    showToast(`${body.fullName}さんを登録しました。`);'''
)

s = s.replace(
'''        await loadRiders("");
      } catch {''',
'''        await loadRiders("", true);
      } catch {'''
)

p.write_text(s, encoding="utf-8", newline="\n")
