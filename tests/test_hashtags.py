from src.hashtags import hashtag_list, normalize_hashtags


def test_plain_words_get_a_hash():
    assert normalize_hashtags("kaicenat kai amp streamer funny viral") == "#kaicenat #kai #amp #streamer #funny #viral"


def test_mixed_inputs():
    assert normalize_hashtags("#Shorts, funny;  ##GTA6 #shorts  #what's-up") == "#Shorts #funny #GTA6 #whatsup"
    assert hashtag_list(["#Shorts", "gaming clips", None, "#"]) == ["#Shorts", "#gaming", "#clips"]
    assert normalize_hashtags(None) == "" and normalize_hashtags("") == ""
