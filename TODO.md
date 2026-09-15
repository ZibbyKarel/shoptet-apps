# TODO

1. [x] v testech se používá await screen.findByText(PŘEKLAD) to ale znamená, že se testy rozbijí pokud někdo změní překlad. V testech se musí používat překladové klíče místo jejich hodnot. Překladová funkce se musí mocknout globálně aby místo přeloženého textu, vracela překladový klíč (main@660605f)
2. [ ] v libs/shared/i18n je MONTH_LOCATIVE_CS - tohle se musí vyřešit překlady.
3. [x] bulk-modal -> toastReagion: Toasty by měly být handlovány globálně. Jeden ToastRegion pro všechny toasty v aplikaci tzn vytvořit globální ToastContextProvider a nějaké "useNotify" které toasty do globálního Provideru dostane. Odstraň všechny lokální ToasRegiony a sjednoť vše pod useNotify hook (main@303d0d2)
4. [x] bulk-modal -> pokud uživatel nakliká více než 5 rezervací za měsíc, mělo by se mu přidání další rezervace zakázat disablováním tlačítek ve formuláři. Také dny, na které už uživatel rezervaci má, musejí být barevně zvírazněny. Použij stejnou rozhodovací logiku jako u barev aut, a změň pozadí dní v kalendáři na které už uživatel rezervaci má. (main@0f9f412)
