from youtube_search import YoutubeSearch
import urllib.parse, requests
class SortedYoutubeSearch(YoutubeSearch):
    def _search(self):
        encoded = urllib.parse.quote_plus(self.search_terms)
        url = f'https://youtube.com/results?search_query={encoded}&sp=CAI%3D'
        print('Fetching:', url)
        r = requests.get(url, timeout=10).text
        results = self._parse_html(r)
        if self.max_results: results = results[:self.max_results]
        return results
res = SortedYoutubeSearch('sre', max_results=5).to_dict()
print([(r.get('title')[:40], r.get('publish_time')) for r in res])
