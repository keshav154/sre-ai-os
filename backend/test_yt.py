from collector import SortedYoutubeSearch
res = SortedYoutubeSearch('sre tutorial', max_results=25).to_dict()
print([(r.get('title'), r.get('publish_time')) for r in res])
