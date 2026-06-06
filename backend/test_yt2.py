from youtube_search import YoutubeSearch
import urllib.parse
import requests
class SortedYoutubeSearch(YoutubeSearch):
    def _search(self):
        encoded_search = urllib.parse.quote_plus(self.search_terms)
        url = f'https://youtube.com/results?search_query={encoded_search}&sp=CAI%3D'
        response = requests.get(url, timeout=10).text
        return self._parse_html(response)

res = SortedYoutubeSearch('sre tutorial', max_results=25).to_dict()
print([(r.get('title'), r.get('publish_time')) for r in res])
