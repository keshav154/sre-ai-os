from duckduckgo_search import DDGS
import sys

print("Testing DDGS...")
try:
    ddgs = DDGS()
    results = ddgs.text("site:youtube.com SRE best practices", max_results=2)
    print("Results type:", type(results))
    results_list = list(results)
    print("Results:", results_list)
except Exception as e:
    import traceback
    traceback.print_exc()
