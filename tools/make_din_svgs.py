"""
Script to generate ON and OFF SVG states for Schneider DIN modules
with exact geometry matching and aligned viewBoxes, matching the Visio states.
Guarantees 100% valid XML without duplicate attributes.
"""
import re
import xml.etree.ElementTree as ET

def set_shape_hidden(src, shape_id, hide=True):
    pattern = re.compile(rf'(<g\s+id="{shape_id}"[^>]*?)>')
    def repl(m):
        tag = m.group(1)
        tag = re.sub(r'\s+style="[^"]*"', '', tag)
        if hide:
            tag += ' style="display:none;"'
        return tag + '>'
    return pattern.sub(repl, src)

def process_iid_2p():
    with open('assets/images/din/schneider_iid_2p.svg', 'r', encoding='utf-8') as f:
        src = f.read()

    # Aligned viewBox without padding (matches Welrok and iC60N height 240.945 pt)
    base = re.sub(
        r'width="[0-9\.]+in"\s+height="[0-9\.]+in"\s+viewBox="[0-9\.\s]+"',
        'width="1.41732in" height="3.34646in" viewBox="1.2596 3.6567 102.047 240.945"',
        src,
        count=1
    )

    # Clean existing styles
    base = set_shape_hidden(base, 'shape12-50', hide=False)
    base = set_shape_hidden(base, 'shape5-32', hide=False)
    base = set_shape_hidden(base, 'shape11-47', hide=False)

    # OFF state:
    off_content = base
    off_content = off_content.replace(
        'transform="translate(2.83465,-85.954)"',
        'transform="translate(2.83465,-64.6866)"'
    )
    off_content = set_shape_hidden(off_content, 'shape12-50', hide=True)
    off_content = set_shape_hidden(off_content, 'shape5-32', hide=False)
    off_content = set_shape_hidden(off_content, 'shape11-47', hide=False)

    ET.fromstring(off_content)

    with open('assets/images/din/schneider_iid_2p_off.svg', 'w', encoding='utf-8') as f:
        f.write(off_content)
    with open('assets/images/din/schneider_iid_2p.svg', 'w', encoding='utf-8') as f:
        f.write(off_content)

    # ON state:
    on_content = base
    on_content = on_content.replace(
        'transform="translate(2.83465,-64.6866)"',
        'transform="translate(2.83465,-85.954)"'
    )
    on_content = set_shape_hidden(on_content, 'shape12-50', hide=False)
    on_content = set_shape_hidden(on_content, 'shape5-32', hide=True)
    on_content = set_shape_hidden(on_content, 'shape11-47', hide=True)

    ET.fromstring(on_content)

    with open('assets/images/din/schneider_iid_2p_on.svg', 'w', encoding='utf-8') as f:
        f.write(on_content)
    print("schneider_iid_2p processed successfully (OFF and ON are 100% valid XML).")


def process_ic60n():
    with open('assets/images/din/schneider_ic60n_1p.svg', 'r', encoding='utf-8') as f:
        src = f.read()

    base = src
    base = set_shape_hidden(base, 'shape3-5', hide=False)
    base = set_shape_hidden(base, 'shape6-14', hide=False)
    base = set_shape_hidden(base, 'shape9-39', hide=False)
    base = set_shape_hidden(base, 'shape14-49', hide=False)

    # OFF state:
    off_content = base
    off_content = off_content.replace(
        'transform="translate(2.83465,-85.954)"',
        'transform="translate(2.83465,-64.6866)"'
    )
    off_content = set_shape_hidden(off_content, 'shape3-5', hide=True)
    off_content = set_shape_hidden(off_content, 'shape6-14', hide=True)
    off_content = set_shape_hidden(off_content, 'shape9-39', hide=False)
    off_content = set_shape_hidden(off_content, 'shape14-49', hide=False)

    ET.fromstring(off_content)

    with open('assets/images/din/schneider_ic60n_1p_off.svg', 'w', encoding='utf-8') as f:
        f.write(off_content)

    # ON state:
    on_content = base
    on_content = on_content.replace(
        'transform="translate(2.83465,-64.6866)"',
        'transform="translate(2.83465,-85.954)"'
    )
    on_content = set_shape_hidden(on_content, 'shape3-5', hide=False)
    on_content = set_shape_hidden(on_content, 'shape6-14', hide=False)
    on_content = set_shape_hidden(on_content, 'shape9-39', hide=True)
    on_content = set_shape_hidden(on_content, 'shape14-49', hide=True)

    ET.fromstring(on_content)

    with open('assets/images/din/schneider_ic60n_1p_on.svg', 'w', encoding='utf-8') as f:
        f.write(on_content)
    print("schneider_ic60n_1p processed successfully (OFF and ON are 100% valid XML).")


def process_welrok():
    with open('assets/images/din/welrok_ui1_red.svg', 'r', encoding='utf-8') as f:
        src = f.read()

    base = set_shape_hidden(src, 'shape8-22', hide=True)
    ET.fromstring(base)

    with open('assets/images/din/welrok_ui1_red.svg', 'w', encoding='utf-8') as f:
        f.write(base)
    print("welrok_ui1_red processed (static digits hidden, 100% valid XML).")


if __name__ == '__main__':
    process_iid_2p()
    process_ic60n()
    process_welrok()
