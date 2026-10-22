source 'https://rubygems.org'

# Versión fijada: sin ella, Bundler resolvía la última github-pages contra Ruby 2.5.1 (.ruby-version anterior) y el
# build de Netlify fallaba al instalar Ruby. 232 es la versión que usa GitHub Pages; corre en Ruby 3.3.
gem 'github-pages', '~> 232', group: :jekyll_plugins
gem "jekyll-github-metadata"
gem "jekyll-octicons"
gem "jemoji"

# Ruby 3 ya no incluye webrick (lo usa `jekyll serve`).
gem "webrick", "~> 1.8"
