import time, re
now=time.time()
def parse_yt_time(time_str):
    if not time_str: return now
    try:
        match = re.search(r'(\d+)', time_str)
        if match:
            val = int(match.group(1))
            if 'second' in time_str: return now - val
            if 'minute' in time_str: return now - val * 60
            if 'hour' in time_str: return now - val * 3600
            if 'day' in time_str: return now - val * 86400
            if 'week' in time_str: return now - val * 604800
            if 'month' in time_str: return now - val * 2592000
            if 'year' in time_str: return now - val * 31536000
    except: pass
    return now

print(now)
print(parse_yt_time('3 years ago'))
print(parse_yt_time('Streamed 3 years ago'))

