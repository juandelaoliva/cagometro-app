"""
Añade las 162 cacas de Antonio (pappalardo95) al JSON del bot de Telegram.
Reconstruye todos los histogramas (days, hours, minutes, months, total)
manteniendo la misma estructura que el resto de usuarios.

Uso:
  python3 fix_antonio.py                          # genera fixed_antonio.json
  python3 fix_antonio.py --check                  # solo muestra el resumen sin escribir
"""

import json, re, sys, copy
from datetime import datetime, timezone, timedelta

# ── Configuración ─────────────────────────────────────────────────────────────
INPUT_JSON  = "cagometro-d0613-export-07-33.json"
LOGS_FILE   = "logs-de-antonio.txt"
OUTPUT_JSON = "fixed_antonio.json"
GROUP_KEY   = "-353783471"
USER        = "pappalardo95"
TZ_OFFSET   = timedelta(hours=2)   # Europe/Madrid en verano (CEST)
TZ_NAME     = "Europe/Madrid"

# ── Helpers ───────────────────────────────────────────────────────────────────
def to_madrid(ts_ms):
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone(TZ_OFFSET))

def parse_logs(path):
    """Parsea el fichero de logs y devuelve lista de timestamps en ms (Europe/Madrid naive→UTC)."""
    entries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            m = re.search(r'\[(\d{2}/\d{2}/\d{4} \d{1,2}:\d{2} [AP]M)\]', line)
            if not m:
                continue
            dt_local = datetime.strptime(m.group(1), "%d/%m/%Y %I:%M %p")
            # Tratar la hora del log como Europe/Madrid (CEST, UTC+2)
            dt_utc = dt_local - TZ_OFFSET
            ts_ms = int(dt_utc.timestamp() * 1000)
            entries.append(ts_ms)
    return sorted(entries)

def build_histograms(dates_ms):
    """
    Reconstruye los arrays de histograma a partir de una lista de timestamps en ms.
    Estructura igual que el resto de usuarios:
      days[32]    → índice = día del mes (1-31), [0] no se usa
      hours[24]   → índice = hora (0-23)
      minutes[60] → índice = minuto (0-59)
      months[N]   → índice = mes (0=Jan, 1=Feb, …), longitud = mes_max+1
      total       → int
    Todo calculado en Europe/Madrid.
    """
    days    = [0] * 32
    hours   = [0] * 24
    minutes = [0] * 60
    months  = {}   # mes_1based → count (months[1]=Ene, months[6]=Jun, …)

    for ts in dates_ms:
        dt = to_madrid(ts)
        days[dt.day] += 1
        hours[dt.hour] += 1
        minutes[dt.minute] += 1
        months[dt.month] = months.get(dt.month, 0) + 1

    # Lista 1-indexed: [0, Ene, Feb, …, mes_max]
    if months:
        max_m = max(months.keys())
        months_list = [months.get(i, 0) for i in range(max_m + 1)]
    else:
        months_list = []

    # Recortar trailing zeros en days, hours, minutes
    def trim(lst):
        while lst and lst[-1] == 0:
            lst.pop()
        return lst

    return {
        "days":    trim(days),
        "hours":   trim(list(hours)),
        "minutes": trim(list(minutes)),
        "months":  months_list,
        "total":   len(dates_ms),
    }

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    check_only = "--check" in sys.argv

    # Cargar JSON base
    with open(INPUT_JSON) as f:
        db = json.load(f)

    group = db["users"][GROUP_KEY]
    ant   = group["stats"][USER]

    # Timestamps existentes
    existing_dates = sorted(ant["dates"])
    existing_zones = ant.get("zones", [])

    # Parsear logs nuevos
    new_timestamps = parse_logs(LOGS_FILE)

    # Comprobar solapamiento
    existing_set = set(existing_dates)
    new_clean = [ts for ts in new_timestamps if ts not in existing_set]
    overlap   = len(new_timestamps) - len(new_clean)

    print(f"Fechas existentes:     {len(existing_dates)}")
    print(f"Entradas en log:       {len(new_timestamps)}")
    print(f"Solapamiento:          {overlap}")
    print(f"Entradas nuevas netas: {len(new_clean)}")

    # Combinar y ordenar
    all_dates = sorted(existing_dates + new_clean)
    all_zones = existing_zones + [TZ_NAME] * len(new_clean)
    # Reordenar zones igual que dates (zip sort)
    paired = sorted(zip(existing_dates, existing_zones)) + \
             sorted(zip(new_clean, [TZ_NAME] * len(new_clean)))
    paired_sorted = sorted(paired, key=lambda x: x[0])
    all_dates = [p[0] for p in paired_sorted]
    all_zones = [p[1] for p in paired_sorted]

    print(f"\nTotal dates tras merge: {len(all_dates)}")

    # Separar por año para reconstruir history
    by_year = {}
    for ts in all_dates:
        y = to_madrid(ts).year
        by_year.setdefault(y, []).append(ts)

    print("\nDesglose por año:")
    for y in sorted(by_year):
        print(f"  {y}: {len(by_year[y])} cacas")

    # Reconstruir history
    new_history = {}
    for y, ts_list in by_year.items():
        new_history[str(y)] = build_histograms(ts_list)

    print("\nHistograma 2026:")
    h26 = new_history.get("2026", {})
    print(f"  total:  {h26.get('total')}")
    print(f"  months: {h26.get('months')}")

    # Counter 2026
    new_counter_2026 = len(by_year.get(2026, []))
    print(f"\nCounter 2026 (nuevo): {new_counter_2026}")
    print(f"Counter anterior:     {group['counter'][USER]}")

    if check_only:
        print("\n[--check] No se ha escrito nada.")
        return

    # Aplicar cambios al JSON
    db_out = copy.deepcopy(db)
    ant_out = db_out["users"][GROUP_KEY]["stats"][USER]

    ant_out["dates"]   = all_dates
    ant_out["zones"]   = all_zones
    ant_out["history"] = new_history

    db_out["users"][GROUP_KEY]["counter"][USER] = new_counter_2026

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(db_out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\n✅ Escrito en {OUTPUT_JSON}")
    print(f"   Tamaño: {len(json.dumps(db_out))/1024:.1f} KB")

if __name__ == "__main__":
    main()
