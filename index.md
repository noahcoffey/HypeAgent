---
title: Updates
layout: null
---

# Updates

{% assign items = site.updates | sort: 'date' | reverse %}
{% for u in items %}
- {{ u.date | date: "%Y-%m-%d %H:%M" }} — [{{ u.title | default: u.id }}]({{ u.url }})
{% endfor %}
