---
title: Updates
layout: null
---

# Updates

{% assign items = site.updates | sort: 'date' | reverse %}
{% for u in items %}
## {{ u.title | default: u.id }}
<p><small>{{ u.date | date: "%Y-%m-%d %H:%M %Z" }}</small></p>

{{ u.content | markdownify }}
---

{% endfor %}
