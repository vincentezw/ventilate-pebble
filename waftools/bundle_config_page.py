import io
import json
import os
import re
import zipfile

from waflib import Logs
from waflib.Configure import conf

APP_CONFIG_DIR = 'app_config'
PBW_ENTRY = 'config.html'


def build_single_config_page(root):
    """
    Read index.html, styles.css, and script.js from the app_config folder
    and inline them into a single HTML byte string.
    """
    config_dir = os.path.join(root, APP_CONFIG_DIR)
    
    index_path = os.path.join(config_dir, 'index.html')
    css_path = os.path.join(config_dir, 'style.css')
    js_path = os.path.join(config_dir, 'script.js')

    for path in (index_path, css_path, js_path):
        if not os.path.exists(path):
            raise ValueError('Missing required config file: %s' % os.path.relpath(path, root))

    with io.open(index_path, encoding='utf-8') as f:
        html = f.read()
    with io.open(css_path, encoding='utf-8') as f:
        css = f.read()
    with io.open(js_path, encoding='utf-8') as f:
        js = f.read()

    # 1. Inline CSS: Replace a matching <link rel="stylesheet" href="styles.css"> tag,
    # or fallback to injecting it into the </head> section.
    css_tag_pattern = re.compile(r'<link[^>]+rel=["\']stylesheet["\'][^>]*href=["\']style\.css["\'][^>]*>', re.IGNORECASE)
    if css_tag_pattern.search(html):
        html = css_tag_pattern.sub(u'<style>\n%s\n</style>' % css, html)
    else:
        html = html.replace('</head>', u'<style>\n%s\n</style>\n</head>' % css)

    # 2. Inline JS: Replace a matching <script src="script.js"></script> tag,
    # or fallback to injecting it right before </body>.
    js_tag_pattern = re.compile(r'<script[^>]+src=["\']script\.js["\'][^>]*></script>', re.IGNORECASE)
    if js_tag_pattern.search(html):
        html = js_tag_pattern.sub(u'<script>\n%s\n</script>' % js, html)
    else:
        html = html.replace('</body>', u'<script>\n%s\n</script>\n</body>' % js)

    return html.encode('utf-8')


def add_config_page(pbw_path, page_bytes, entry_name=PBW_ENTRY):
    """
    Rewrite the pbw with the single bundled page at its root and appinfo.json naming it.
    Rewriting rather than appending keeps a rebuild from stacking copies.
    """
    with zipfile.ZipFile(pbw_path, 'r') as source:
        entries = [(info, source.read(info.filename))
                   for info in source.infolist() if info.filename != entry_name]

    replacement = pbw_path + '.tmp'
    with zipfile.ZipFile(replacement, 'w', zipfile.ZIP_DEFLATED) as target:
        for info, data in entries:
            if info.filename == 'appinfo.json':
                appinfo = json.loads(data.decode('utf-8'))
                if appinfo.get('configPage') != entry_name:
                    appinfo['configPage'] = entry_name
                    data = json.dumps(appinfo, indent=2, sort_keys=True).encode('utf-8')
            target.writestr(info, data)
        target.writestr(entry_name, page_bytes)

    os.remove(pbw_path)
    os.rename(replacement, pbw_path)


@conf
def bundle_config_page(ctx):
    root = ctx.path.abspath()
    
    try:
        page_bytes = build_single_config_page(root)
    except Exception as e:
        ctx.fatal(str(e))

    build_dir = ctx.bldnode.abspath()
    pbws = [os.path.join(build_dir, name)
            for name in os.listdir(build_dir) if name.endswith('.pbw')]
    if not pbws:
        ctx.fatal('No pbw found in %s to add the config page to' % build_dir)

    for pbw in pbws:
        add_config_page(pbw, page_bytes)
        Logs.info('Bundled combined config page into %s as %s' % (
            os.path.relpath(pbw, root), PBW_ENTRY))
