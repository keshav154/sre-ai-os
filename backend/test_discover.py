import sys
sys.path.append('.')
from collector import auto_discover

try:
    print("Testing auto_discover...")
    res = auto_discover()
    print(f"Total Discovered: {res}")
except Exception as e:
    import traceback
    traceback.print_exc()
