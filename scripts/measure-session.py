#!/usr/bin/env python3
"""measure-session.py — token + tool accounting for one omp session.

Usage:
    python3 measure-session.py <session.jsonl> [label]

Finds the session transcript under ~/.omp/agent/sessions/**/<id>.jsonl if you pass a
bare session id instead of a path. Prints the conductor-side token breakdown (exact)
and tool-call counts. NOTE: this measures the conductor side only — agy/Gemini tokens
are not exposed by `agy --print`, so the cheap-side cost must be priced separately.
"""
import json, os, sys, glob

def load_prices():
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (os.path.join(here, "..", "prices.json"),
              os.path.join(here, "prices.json"), "prices.json"):
        try:
            with open(p) as f:
                return json.load(f)
        except Exception:
            continue
    return None

def resolve(arg):
    if os.path.isfile(arg):
        return arg
    base = os.path.expanduser("~/.omp/agent/sessions")
    exact = glob.glob(f"{base}/**/{arg}.jsonl", recursive=True)
    if exact:
        return exact[0]
    hits = sorted(glob.glob(f"{base}/**/{arg}*.jsonl", recursive=True))
    if len(hits) > 1:
        sys.stderr.write(f"warning: {len(hits)} files match '{arg}'; using {hits[0]}\n")
    return hits[0] if hits else None

def measure(path):
    ti = to = tcc = tcr = turns = 0
    tools = {}
    with open(path) as f:
      for line in f:
        try:
            o = json.loads(line)
        except Exception:
            continue
        m = o.get("message")
        if not isinstance(m, dict):
            continue
        c = m.get("content")
        if isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") == "toolCall":
                    n = b.get("name", "?")
                    tools[n] = tools.get(n, 0) + 1
        u = m.get("usage")
        if not u:
            continue
        turns += 1
        ti += u.get("input", 0)
        to += u.get("output", 0)
        tcc += u.get("cacheWrite", 0)
        tcr += u.get("cacheRead", 0)
    return dict(turns=turns, input=ti, output=to, cache_create=tcc, cache_read=tcr,
                total=ti + to + tcc + tcr, tools=tools)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    path = resolve(sys.argv[1])
    label = sys.argv[2] if len(sys.argv) > 2 else (os.path.basename(path) if path else sys.argv[1])
    if not path:
        print(f"session not found: {sys.argv[1]}"); sys.exit(1)
    r = measure(path)
    # cost-weighted units, normalized to input=1: output 5x, cache_write 1.25x,
    # cache_read 0.1x (standard conductor-model multipliers; absolute $ varies by model).
    weighted = (r['output'] * 5 + r['input'] * 1 +
                r['cache_create'] * 1.25 + r['cache_read'] * 0.1)
    print(f"=== {label} ===")
    print(f"  turns          {r['turns']}")
    print(f"  output         {r['output']:,}   <- expensive (frontier)")
    print(f"  input          {r['input']:,}")
    print(f"  cache_create   {r['cache_create']:,}   <- 1.25x input (cache writes)")
    print(f"  cache_read     {r['cache_read']:,}   <- 0.1x input (the cheap re-read)")
    print(f"  TOTAL tokens   {r['total']:,}")
    print(f"  COST-WEIGHTED  {weighted:,.0f}   <- model-agnostic $-proxy (output 5x, etc.)")
    pr = load_prices()
    if pr and isinstance(pr.get(pr.get("orchestrator", "claude_opus")), dict):
        deck = pr.get("orchestrator", "claude_opus")
        m = pr[deck]; IN, OUT = m.get("in"), m.get("out")
        cw = pr.get("cache_write_mult", 1.25); crd = pr.get("cache_read_mult", 0.10)
        if IN and OUT:
            usd = (r['output']*OUT + r['input']*IN +
                   r['cache_create']*IN*cw + r['cache_read']*IN*crd) / 1e6
            print(f"  est. USD       ${usd:,.4f}   ({deck} deck, prices.json — VERIFY)")
    print(f"  tool calls     {sum(r['tools'].values())}  {r['tools']}")
    print(f"  scope          main session loop only — subagent/workflow transcripts (separate files) NOT counted")