import requests

uri="http://host3.dreamhack.games:16336/user/guest.json"

response = requests.options(uri)

print(response.headers)
