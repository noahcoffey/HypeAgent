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
  {% assign summary = site.updates | where: "ha_kind", "summary" | sort: 'date' | reverse %}
  {% assign items = summary %}
  {% if summary.size == 0 %}
    {% assign coll = site.updates | sort: 'date' | reverse %}
    {% assign legacy = site.pages | where_exp: "p", "p.url contains '/updates/'" | sort: 'date' | reverse %}
    {% assign items = coll | concat: legacy | sort: 'date' | reverse %}
  {% endif %}
  {% if items.size == 0 %}
    <p class="meta">No updates yet. Run the CLI to generate your first post.</p>
  {% endif %}
  {% for post in items %}
    <div class="post">
      {% assign display_title = post.title | default: post.name | default: post.id %}
      <h2><a href="{{ post.url | relative_url }}">{{ display_title }}</a></h2>
      <p class="meta"><span class="dt" data-iso="{{ post.date | default: post.createdAt }}"></span></p>
      {% capture raw %}{{ post.content }}{% endcapture %}
      {% assign parts = raw | split: '---' %}
      {% if parts.size > 2 %}{{ parts[2] }}{% else %}{{ raw }}{% endif %}
      <hr class="sep" />
      <p class="meta"><a href="{{ post.url | relative_url }}">Permalink</a></p>
    </div>
  {% endfor %}
  <script>
    (function(){
      function fmt(iso){
        var dt = new Date(iso);
        var opts = { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' };
        try { return dt.toLocaleString(undefined, opts); } catch(e) { return dt.toISOString(); }
      }
      function rel(iso){
        var now = new Date();
        var then = new Date(iso);
        var diffMs = now - then;
        var mins = Math.round(diffMs/60000);
        if (mins < 60) return mins + ' minutes ago (' + fmt(iso) + ')';
        var hours = Math.round(mins/60);
        if (hours < 24) return hours + ' hours ago (' + fmt(iso) + ')';
        var days = Math.round(hours/24);
        return days + ' days ago (' + fmt(iso) + ')';
      }
      Array.prototype.slice.call(document.querySelectorAll('.dt')).forEach(function(el){
        var iso = el.getAttribute('data-iso');
        if (!iso) {
          var post = el.closest('.post');
          var a = post ? post.querySelector('h2 a') : null;
          var href = a ? (a.getAttribute('href') || '') : '';
          // infer ISO from permalink like: update-2025-08-20T18-36-46-095Z-summary.html
          var m = href.match(/update-([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{3})Z/i);
          if (m) {
            iso = m[1] + ':' + m[2] + ':' + m[3] + '.' + m[4] + 'Z';
          }
        }
        if (iso) el.textContent = rel(iso);
      });
    })();
  </script>
</div>
