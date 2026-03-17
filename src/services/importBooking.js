/**
 * importBooking.js — Import CSV Booking.com Payout
 *
 * Usage : importer le fichier "Payout_from_XXXX_until_XXXX.csv"
 * telecharge depuis Booking.com Extranet > Finance > Transactions
 *
 * Logique anti-doublons :
 * - Contrainte UNIQUE (mouvement_id, booking_ref, payout_date) en base
 * - Upsert avec ignoreDuplicates : reimporter le meme fichier = 0 insertion
 * - Chevauchement de periodes : les lignes deja presentes sont ignorees
 *
 * Matching mouvement bancaire :
 * - Payout date CSV = date_operation bancaire - 1 a 4 jours (Booking verse avant reception)
 * - On cherche le mouvement Booking en attente dans une fenetre de 5 jours apres la payout date
 */
import { supabase } from '../lib/supabase'

function parseFloat2(s) {
    if (!s || s === '-') return 0
    return parseFloat(String(s).replace(',', '.').replace(' ', '')) || 0
}

function parseDate(s) {
    if (!s || s === '-') return null
    const fmts = [
          [/^(\d{4})-(\d{2})-(\d{2})$/, (m) => `${m[1]}-${m[2]}-${m[3]}`],
          [/^(\d{2})\/(\d{2})\/(\d{4})$/, (m) => `${m[3]}-${m[2]}-${m[1]}`],
          [/^(\d{2})\/(\d{2})\/(\d{2})$/, (m) => `20${m[3]}-${m[2]}-${m[1]}`],
        ]
    for (const [re, fn] of fmts) {
          const m = s.trim().match(re)
          if (m) return fn(m)
    }
    return null
}

/**
 * Parse le CSV Booking.com et retourne les lignes groupees par payout_date
 */
export function parseBookingCSV(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) throw new Error('Fichier vide')

  // Detecter le separateur (virgule ou point-virgule)
  const sep = lines[0].includes(';') ? ';' : ','

  // Parser les headers
  const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim())

  const col = (name) => {
        const i = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()))
        return i >= 0 ? i : -1
  }

  const iPayoutDate = col('Payout date')
    const iRef = col('Reference number')
    const iCheckin = col('Check-in date')
    const iCheckout = col('Check-out date')
    const iProp = col('Property name')
    const iPropId = col('Property ID')
    const iAmount = col('Payable amount')
    const iGross = col('Gross amount')
    const iComm = col('Commission')
    const iStatus = col('Reservation status')

  if (iPayoutDate < 0) throw new Error('Colonne "Payout date" introuvable — verifiez le format du fichier')
    if (iAmount < 0) throw new Error('Colonne "Payable amount" introuvable')

  const rowsByPayoutDate = {}
      for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(sep).map(c => c.replace(/^"|"$/g, '').trim())
            const pdate = parseDate(cols[iPayoutDate])
            if (!pdate) continue

      const amount = parseFloat2(cols[iAmount] || '0')

      if (!rowsByPayoutDate[pdate]) rowsByPayoutDate[pdate] = []
            rowsByPayoutDate[pdate].push({
                    payout_date: pdate,
                    booking_ref: (cols[iRef] || '').replace('-', '').trim() || null,
                    checkin: parseDate(cols[iCheckin] || ''),
                    checkout: parseDate(cols[iCheckout] || ''),
                    property_name: cols[iProp] || null,
                    property_id: cols[iPropId] || null,
                    amount_cents: Math.round(amount * 100),
                    gross_cents: Math.round(parseFloat2(cols[iGross] || '0') * 100),
                    commission_cents: Math.round(parseFloat2(cols[iComm] || '0') * 100),
                    reservation_status: (cols[iStatus] || '') === '-' ? null : (cols[iStatus] || null),
            })
      }

  return rowsByPayoutDate
}

/**
 * Importe un CSV Booking.com :
 * 1. Parse le CSV
 * 2. Pour chaque payout_date, cherche le mouvement bancaire Booking correspondant (+1 a 4j)
 * 3. Insere les lignes dans booking_payout_line (ignore les doublons)
 * 4. Marque les mouvements comme rapproches
 *
 * @param {string} csvText - Contenu du fichier CSV
 * @returns {{ parsed, matched, inserted, already_existing, errors }}
 */
export async function importBookingCSV(csvText) {
    const log = { parsed: 0, matched: 0, inserted: 0, already_existing: 0, errors: 0, details: [] }

  try {
        const rowsByPayoutDate = parseBookingCSV(csvText)
        const allPayoutDates = Object.keys(rowsByPayoutDate).sort()
        log.parsed = Object.values(rowsByPayoutDate).reduce((s, r) => s + r.length, 0)

      if (!allPayoutDates.length) {
              log.details.push('Aucune payout date trouvee dans le CSV')
              return log
      }

      // Charger tous les mouvements Booking (en attente + deja rapproches)
      // sur la periode couverte par le CSV (+5j pour la fenetre de matching)
      const dateMin = allPayoutDates[0]
        const dateMax = allPayoutDates[allPayoutDates.length - 1/]*
          * 
             *  /i/m pAojrotuBtoeork i5njg .pjosu r—  Ilmap ofretn eCtSrVe 
  B o o k icnogn.scto md aPtaeyMoauxtP
    l u*s
    5  *=  Unseawg eD a:t ei(mdpaotretMearx )l
    e   f i cdhaiteerM a"xPPalyuosu5t._sfertoDma_tXeX(XdXa_tuenMtaixlP_lXuXsX5X..gcestvD"a
    t e*( )t e+l e5c)h
    a r g e  cdoenpsuti sd aBtoeoMkaixnSgt.rc o=m  dEaxtterMaanxePtl u>s 5F.itnoaInScOeS t>r iTnrga(n)s.ascltiicoen(s0
                                                                                                                    ,  *1
    0 )*

      L o g i qcuoen satn t{i -ddaotuab:l omnosu v:s
                           }*  =-  aCwoanittr asiunptaeb aUsNeI
    Q U E   ( m o.ufvreomme(n'tm_oiudv,e mbeonotk_ibnagn_craeifr,e 'p)a
    y o u t _ d a.tsee)l eecnt (b'aisde,
        c*r e-d iUtp,s edratt ea_voepce riagtnioorne,D usptlaitcuatt_emsa t:c hrienigm'p)o
      r t e r   l e. emqe(m'ec afniaclh'i,e r' b=o o0k iinngs'e)r
    t i o n 
     *. g-t eC(h'edvaatuec_hoepmeernatt idoen 'p,e rdiaotdeeMsi n:) 
    l e s   l i g.nletse (d'edjaat ep_roepseernatteiso ns'o,n td aitgenMoarxeSetsr
    ) 
  * 
         *   M a.tocrhdienrg( 'mdoautvee_moepnetr abtainocna'i)r
    e
      : 
       *i f-  (P!amyoouuvts ?d.alteen gCtShV)  ={ 
               d a t e _ o pleorga.tdieotna iblasn.cpauisrhe( `-A u1c uan  4m ojuovuermse n(tB oBookoiknign gv eernster ea v$a{ndta treeMcienp}t ieotn )$
                                                             { d*a t-e MOanx Scthre}r`c)h
               e   l e  }m
  o
  u v e m e/n/t  PBoouork icnhga qeune  aptatyeonutte_ ddaatnes  duun eC SfVe,n ettrroeu vdeer  5l ej omuorusv eampernets  cloar rpeasypoountd adnatt
  e 
   * /c
  oinmspto ruts e{d MsouupvaIbdass e=  }n efwr oSme t'(.).
    /
    l i b / sfuopra b(acsoen's
    t
   fpudnacttei oonf  paalrlsPeaFyloouattD2a(tse)s ){ 
     { 
       i f   ( ! sc o|n|s ts  r=o=w=s  '=- 'r)o wrseBtyuPrany o0u
       t D arteet[uprdna tpea]r
       s e F l o a tc(oSntsrti npgd(ast)e.Orbejp l=a cnee(w' ,D'a,t e'(.p'd)a.tree)p
       l
       a c e ( '   '/,/  'C'h)e)r c|h|e r0 
              l}e

  mfouunvcetmieonnt  pBaoroskeiDnagt ed(asn)s  {l
                                                e s  i1f- 5( !jso u|r|s  ss u=i=v=a n't- 'p)d arteet
                                                u r n   n u lclo
                                                n s tc omnosutv  f=m tmso u=v s[?
                                                  . f i n d[(/m^ (=\>d {{4
                                                             } ) - ( \ d { 2 }i)f- ((\uds{e2d}M)o$u/v,I d(sm.)h a=s>( m`.$i{dm)[)1 ]r}e-t$u{rmn[ 2f]a}l-s$e{
                                                             m [ 3 ] } ` ] , 
                                                  c o n s t[ /m^d(a\tde{ 2=} )n\e/w( \Dda{t2e}()m\./d(a\tde{_4o}p)e$r/a,t i(omn)) 
                                                  = >   ` $ { m [ 3c]o}n-s$t{ md[i2f]f} -=$ {(mm[d1a]t}e` ]-, 
                                                  p d a t e[O/b^j()\ d/{ 28}6)4\0/0(0\0d0{
                                                  2 } ) \ / ( \ d {r2e}t)u$r/n,  d(imf)f  =>>=  `02 0&$&{ md[i3f]f} -<$={ m5[
                                                  2 ] } - $ { m}[)1
                                                  ]
                                                  } ` ] , 
         i]f
                                                  ( !fmooru v()c o{n
                                                                   s t   [ r e ,   flno]g .odfe tfamitlss). p{u
                                                                                                              s h ( ` Pcaosn sdte  mm o=u vse.mternitm (B)o.omkaitncgh (proeu)r
                                                                                                                p a y oiuft _(dma)t er e$t{uprdna tfen}( m()$
                                                                                                                   { r o}w
                                                                                                                   s . lreentgutrhn}  nluilgln
                                                                                                                   e}s
                                                                                                                    
                                                                                                                    i/g*n*o
                                                                                                                    r e*e sP)a`r)s
                                                                                                              e   l e   C S V  cBoonotkiinnuge.
                                                                                                                c o m   e t  }r
                                                                   e
                                                                   t o u r n e  ulseesd MloiugvnIedss .gardodu(pmeoeusv .piadr) 
     p a y o u t _ldoagt.em
                                                                   a t*c/h
                                                                   eedx+p+o
                                                                   r
                                                                   t   f u n c t/i/o nC opnasrtsreuBioroek ilnegsC SlVi(gtneexst )a  {i
                                                                                                                                      n s ecroenrs
                                                                                                                                      t   l i n e sc o=n stte xtto.Isnpsleirtt( '=\ nr'o)w.sm.ampa(pl( r= >= >l .(t{r
                                                                                                                                                                                                                    i m ( ) ) . f i l.t.e.rr(,B
                                                                                                                                                                                                                    o o l e a n ) 
                                                                                                                                                                                                        m oiufv e(m!elnitn_eisd.:l emnogutvh.)i dt,h
                                                                                                                                      r o w   n e w   Egrureosrt(_'nFaimceh:i enru lvli,d
                                                                                                                                        e ' ) 
                                                                                                                                         
                                                                                                                                     }/)/) 
     D
                                                                   e t e c t e r/ /l eU psseepratr aatveeucr  i(gvniorrgeuDluep loiuc aptoeisn t— -svii rmgeumlee )(
                                                                   m o ucvoenmsetn ts_eipd ,=  bloionkeisn[g0_]r.eifn,c lpuadyeosu(t'_;d'a)t e?) ,' ;i'g n:o r'e,
                                                                     ' 

          / /c oPnasrts e{r  elrerso rh,e acdoeurnst
                                                                  }  c=o naswta ihte asdueprasb a=s el
     i n e s [ 0 ] . s.pflriotm((s'ebpo)o.kmianpg(_hp a=y>o uht._rleipnlea'c)e
     ( / ^ " | " $ / g.,u p's'e)r.tt(rtiomI(n)s)e
     r
     t ,  c{o
            n s t   c o l   =   (onnaCmoen)f l=i>c t{:
              ' m o ucvoenmsetn ti_ i=d ,hbeoaodkeirnsg._frienfd,Ipnadyeoxu(th_ d=a>t eh'.,t
            o L o w e r C a s e (i)g.nionrcelDuudpelsi(cnaatmees.:t otLrouwee,r
                                                       C a s e ( ) ) ) 
         c o urnett:u r'ne xia c>t=' ,0
              ?   i   :   - 1}
     ) 

   } 

     c oinfs t( eirPraoyro)u t{D
                               a t e   =   c o ll(o'gP.aeyroruotr sd+a+t
                                 e ' ) 
                                      c o nlsotg .idReetfa i=l sc.oplu(s'hR(e`fEerrreenucre  innusmebretri'o)n
                                 $ {cpodnastte }i:C h$e{cekrirno r=. mceosls(a'gCeh}e`c)k
                                 - i n   d a t e 'c)o
                                 n t icnounes
                                 t   i C h e c}k
                                 o
                                 u t   =   c oclo(n'sCth encbkI-nosuetr tdeadt e=' )c
                                 o u ncto n|s|t  0i
                                 P r o p   =  ccoonls(t' PnrboEpxeirsttyi nnga m=e 't)o
                                 I n sceornts.tl einPgrtohp I-d  n=b Icnosle(r'tPerdo
                                 p e r t y   IlDo'g).
                                 i n sceorntsetd  i+A=m onubnItn s=e rctoeld(
                                 ' P a y a b lleo ga.maolurneta'd)y
                                 _ e xciosntsitn gi G+r=o snsb E=x icsotli(n'gG
                                 r
                                 o s s   a m o/u/n tM'e)t
                                 t r ec oan sjto uirC olmem  d=e tcaoill( 'eCto mrmaipspsrioocnh'e)r
                                   l ec omnosutv eimSetnatt
                               u s   =   c oclo(n'sRte snebrRveastaiso n=  srtoawtsu.sf'i)l
                               t
                               e r (irf  =(>i Pra.yboouotkDiantge_ r<e f0)). ltehnrgotwh 
  n e w   E r rcoorn(s'tC otlootnanleC o"mPma y=o urto wdsa.tree"d uicnet(r(osu,v arb)l e= >—  vse r+i fMiaetzh .laeb sf(orr.mcaotm mdius sfiiocnh_iceern't)s
                               ) ,  i0f) 
  ( i A m o u ncto n<s t0 )p rtohprso w=  n[e.w. .Enrerwo rS(e'tC(orloownsn.ef i"lPtaeyra(brl e= >a mro.upnrto"p eirnttyr_onuavmaeb)l.em'a)p
                               (
                                 r   =c>o nrs.tp rroopwesrBtyyP_anyaomuet)D)a]t
                               e   =   { } 
                                 c o nfsotr  d(elteati li  ==  `1B;o oik i<n gl i|n e$s{.nlbeRnegstahs;}  ir+e+s)a ({s
                                 )   |   ccoomnmsits scioolns:  =$ {l(itnoetsa[liC]o.msmp l/i t1(0s0e)p.)t.omFaipx(ecd (=2>) }c\.ur2e0pAlCa$c{ep(r/o^p"s|."l$e/ngg,t h' '?) .'t r|i m'( )+) 
                                 p r o p sc.osnlsitc ep(d0a,t e2 )=. jpoairns(e'D,a t'e)( c:o l's'[}i`P
                                               a
                               y o u t D a taew]a)i
                               t   s u piafb a(s!ep
                                 d a t e )   c o n.tfirnoume(
                                   '
                                   m o u v ecmoennstt_ baamnocuanitr e=' )p
                                   a r s e F l o a t.2u(pcdoaltse[(i{A msotuanttu]t _|m|a t'c0h'i)n
                                                                     g
                                                                     :   ' r aipfp r(o!crhoew's,B ydPeatyaoiult D}a)t
                               e [ p d a t e ] ). erqo(w'siBdy'P,a ymoouutvD.aitde)[
                                 p d a t e}]

=   [}] 
  c a t c hr o(wes)B y{P
                       a y o u tlDoagt.ee[rprdoartse+]+.
                         p u s h (l{o
                         g . d e t a iplasy.opuuts_hd(a'tEer:r epudra:t e', 
                           +   e . m e sbsoaogkei)n
                       g _ r}e
  f
  :   (rceotlusr[ni Rleofg]
       }|| '').replace('-', '').trim() || null,
          checkin: parseDate(cols[iCheckin] || ''),
          checkout: parseDate(cols[iCheckout] || ''),
          property_name: cols[iProp] || null,
          property_id: cols[iPropId] || null,
          amount_cents: Math.round(amount * 100),
          gross_cents: Math.round(parseFloat2(cols[iGross] || '0') * 100),
          commission_cents: Math.round(parseFloat2(cols[iComm] || '0') * 100),
          reservation_status: (cols[iStatus] || '') === '-' ? null : (cols[iStatus] || null),
    })
}

  return rowsByPayoutDate
}

/**
 * Importe un CSV Booking.com :
 * 1. Parse le CSV
 * 2. Pour chaque payout_date, cherche le mouvement bancaire Booking correspondant (+1 a 4j)
 * 3. Insere les lignes dans booking_payout_line (ignore les doublons)
 * 4. Marque les mouvements comme rapproches
 *
 * @param {string} csvText - Contenu du fichier CSV
 * @returns {{ parsed, matched, inserted, already_existing, errors }}
 */
export async function importBookingCSV(csvText) {
    const log = { parsed: 0, matched: 0, inserted: 0, already_existing: 0, errors: 0, details: [] }

  try {
        const rowsByPayoutDate = parseBookingCSV(csvText)
        const allPayoutDates = Object.keys(rowsByPayoutDate).sort()
        log.parsed = Object.values(rowsByPayoutDate).reduce((s, r) => s + r.length, 0)

      if (!allPayoutDates.length) {
              log.details.push('Aucune payout date trouvee dans le CSV')
              return log
      }

      // Charger tous les mouvements Booking (en attente + deja rapproches)
      // sur la periode couverte par le CSV (+5j pour la fenetre de matching)
      const dateMin = allPayoutDates[0]
        const dateMax = allPayoutDates[allPayoutDates.length - 1]
        // Ajouter 5j pour la fenetre
      const dateMaxPlus5 = new Date(dateMax)
        dateMaxPlus5.setDate(dateMaxPlus5.getDate() + 5)
        const dateMaxStr = dateMaxPlus5.toISOString().slice(0, 10)

      const { data: mouvs } = await supabase
          .from('mouvement_bancaire')
          .select('id, credit, date_operation, statut_matching')
          .eq('canal', 'booking')
          .gte('date_operation', dateMin)
          .lte('date_operation', dateMaxStr)
          .order('date_operation')

      if (!mouvs?.length) {
              log.details.push(`Aucun mouvement Booking entre ${dateMin} et ${dateMaxStr}`)
      }

      // Pour chaque payout_date du CSV, trouver le mouvement correspondant
      const usedMouvIds = new Set()

      for (const pdate of allPayoutDates) {
              const rows = rowsByPayoutDate[pdate]
              const pdateObj = new Date(pdate)

          // Chercher le mouvement Booking dans les 1-5 jours suivant pdate
          const mouv = mouvs?.find(m => {
                    if (usedMouvIds.has(m.id)) return false
                    const mdate = new Date(m.date_operation)
                    const diff = (mdate - pdateObj) / 86400000
                    return diff >= 0 && diff <= 5
          })

          if (!mouv) {
                    log.details.push(`Pas de mouvement Booking pour payout_date ${pdate} (${rows.length} lignes ignorees)`)
                    continue
          }

          usedMouvIds.add(mouv.id)
              log.matched++

          // Construire les lignes a inserer
          const toInsert = rows.map(r => ({
                    ...r,
                    mouvement_id: mouv.id,
                    guest_name: null,
          }))

          // Upsert avec ignoreDuplicates — si meme (mouvement_id, booking_ref, payout_date), ignore
          const { error, count } = await supabase
                .from('booking_payout_line')
                .upsert(toInsert, {
                            onConflict: 'mouvement_id,booking_ref,payout_date',
                            ignoreDuplicates: true,
                            count: 'exact',
                })

          if (error) {
                    log.errors++
                    log.details.push(`Erreur insertion ${pdate}: ${error.message}`)
                    continue
          }

          const nbInserted = count || 0
              const nbExisting = toInsert.length - nbInserted
              log.inserted += nbInserted
              log.already_existing += nbExisting

          // Mettre a jour le detail et rapprocher le mouvement
          const nbResas = rows.filter(r => r.booking_ref).length
              const totalComm = rows.reduce((s, r) => s + Math.abs(r.commission_cents), 0)
              const props = [...new Set(rows.filter(r => r.property_name).map(r => r.property_name))]
              const detail = `Booking | ${nbResas} resa(s) | commission: ${(totalComm / 100).toFixed(2)}\u20AC${props.length ? ' | ' + props.slice(0, 2).join(', ') : ''}`

          await supabase
                .from('mouvement_bancaire')
                .update({ statut_matching: 'rapproche', detail })
                .eq('id', mouv.id)
      }

  } catch (e) {
        log.errors++
        log.details.push('Erreur: ' + e.message)
  }

  return log
}
