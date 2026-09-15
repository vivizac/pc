from pathlib import Path

path = Path('pc-shell.css')
text = path.read_text(encoding='utf-8')
needle = ".olliPcSearch:focus{border-color:#b9d9ff;box-shadow:0 0 0 3px rgba(22,135,255,.08);}\n"
insert = """.olliPcSearch:focus{border-color:#b9d9ff;box-shadow:0 0 0 3px rgba(22,135,255,.08);}\n\n/* PC 공통 검색창: X 아이콘은 작게 유지하고 버튼 박스 전체를 클릭영역으로 사용 */\nbody.olliPcApp input[type=\"search\"]::-webkit-search-cancel-button{\n  -webkit-appearance:none;\n  appearance:none;\n  width:32px;\n  min-width:32px;\n  height:32px;\n  margin:0 -9px 0 6px;\n  border-radius:50%;\n  cursor:pointer;\n  background-color:transparent;\n  background-image:\n    linear-gradient(45deg,transparent calc(50% - .7px),#91969e calc(50% - .7px),#91969e calc(50% + .7px),transparent calc(50% + .7px)),\n    linear-gradient(-45deg,transparent calc(50% - .7px),#91969e calc(50% - .7px),#91969e calc(50% + .7px),transparent calc(50% + .7px));\n  background-position:center;\n  background-repeat:no-repeat;\n  background-size:11px 11px;\n}\nbody.olliPcApp input[type=\"search\"]::-webkit-search-cancel-button:hover{background-color:#f2f3f5;}\nbody.olliPcApp input[type=\"search\"]::-webkit-search-cancel-button:active{background-color:#e9ebee;}\nbody.olliPcApp .recordSearchClose,\nbody.olliPcApp button[aria-label=\"검색 닫기\"],\nbody.olliPcApp button[aria-label=\"검색 지우기\"],\nbody.olliPcApp button[aria-label=\"검색어 지우기\"]{\n  min-width:32px;\n  min-height:32px;\n  cursor:pointer;\n  -webkit-tap-highlight-color:transparent;\n}\n"""
if needle not in text:
    raise SystemExit('target search focus rule not found')
if 'PC 공통 검색창: X 아이콘은 작게 유지하고 버튼 박스 전체를 클릭영역으로 사용' in text:
    raise SystemExit('patch already present')
path.write_text(text.replace(needle, insert, 1), encoding='utf-8')
