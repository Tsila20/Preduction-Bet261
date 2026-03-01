# ⚽ BET261 Preductor — Football (Web App)

Preductor Football miasa amin’ny navigateur (GitHub Pages).
Mamoaka probabilités sy marchés dérivés à partir des odds 1X2 :

- 1X2
- Double chance (1X, 12, X2)
- GG / NG (BTTS)
- Over / Under (0.5 → 5.5)
- Clean sheets
- Top scores exacts
- Indication: BET / WATCH / NO BET (risk mode)

---

## 🔬 Mécanique (Mode Quick)

1. Dé-vig des odds 1X2 (normalisation des probabilités)
2. Estimation des buts attendus (λ Home, λ Away)
3. Modèle de Poisson → matrice des scores (0–6)
4. Agrégation → marchés dérivés

⚠️ Mode Quick = basé uniquement sur les odds 1X2  
📈 Mode Pro (à venir) = calibration sur historique + backtest

---

## 🚀 Déploiement (GitHub Pages)

1. Repo → Settings → Pages  
2. Source: Deploy from branch  
3. Branch: main / root  
4. Accéder à :  
   https://<username>.github.io/bet261-predictor/

---

## 📂 Structure
