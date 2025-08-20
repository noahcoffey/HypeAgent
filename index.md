---
title: Updates
layout: null
---

<style>
  :root { --fg:#0b1320; --muted:#5b667a; --bg:#f7fafc; --card:#ffffff; --accent:#2f73ff; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); margin: 0; }
  .wrap { max-width: 780px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 28px; margin: 0 0 16px; }
  .post { background: var(--card); border: 1px solid #e7ecf3; border-radius: 12px; padding: 20px 20px; margin: 16px 0; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  .post h2 { font-size: 20px; margin: 0 0 8px; }
  .post h2 a { color: inherit; text-decoration: none; }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
  hr.sep { border: none; border-top: 1px solid #eef2f7; margin: 16px 0 0; }
</style>

<div class="wrap">
  <h1>Latest Updates</h1>
  {% assign items = site.updates | where: "ha_kind", "summary" | sort: 'date' | reverse %}
  {% for post in items %}
    <div class="post">
      {% if post.title %}<h2><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h2>{% endif %}
      <p class="meta">{{ post.date | date: "%b %-d, %Y" }}</p>
      {{ post.content }}
      <hr class="sep" />
      <p class="meta"><a href="{{ post.url | relative_url }}">Permalink</a></p>
    </div>
  {% endfor %}
</div>
