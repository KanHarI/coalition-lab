"""Fetch the configured public Polymarket events; no API key is needed."""
import concurrent.futures
import datetime
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
slugs = json.loads((root / "data/market-slugs.json").read_text())

def fetch(slug):
    data = subprocess.check_output(["curl", "--fail", "--silent", "--show-error", "--max-time", "20", f"https://gamma-api.polymarket.com/events/slug/{slug}"])
    event = json.loads(data)
    if event.get("slug") != slug or not event.get("markets"):
        raise ValueError(f"Invalid event: {slug}")
    return event

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    events = list(pool.map(fetch, slugs))
snapshot = {"fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "events": events}
(root / "data/snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n")
for event in events:
    print(event["title"], "|", ", ".join(f'{m.get("groupItemTitle")}: {m.get("outcomePrices")}' for m in event["markets"]))
