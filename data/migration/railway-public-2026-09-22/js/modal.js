/**
 * Shared Modal Component for OTTflix
 * Used by both index.html and chat.html
 */

const MovieModal = (function() {
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
  const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';
  const TMDB_PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

  let currentLang = 'ja';
  let translations = {};
  let callbacks = {};
  let currentMovieId = null; // Track current movie for similarity reasons

  // Helper functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function getTitle(m) {
    return currentLang === 'ja' ? (m.title_ja || m.title) : (m.title || m.title_ja);
  }

  function getPoster(m) {
    if (currentLang === 'en' && m.poster_path_en) return TMDB_IMAGE_BASE + m.poster_path_en;
    if (m.poster_path) return TMDB_IMAGE_BASE + m.poster_path;
    return 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 200 300%27%3E%3Crect fill=%27%23222%27 width=%27200%27 height=%27300%27/%3E%3Ctext x=%27100%27 y=%27150%27 text-anchor=%27middle%27 fill=%27%23555%27 font-size=%2740%27%3E%F0%9F%8E%AC%3C/text%3E%3C/svg%3E';
  }

  function getOverview(m) {
    return currentLang === 'ja' ? (m.overview_ja || m.overview) : (m.overview || m.overview_ja);
  }

  function t(key) {
    return translations[key] || key;
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  }

  function renderProvider(p, tmdbId) {
    const link = tmdbId ? `https://www.themoviedb.org/movie/${tmdbId}/watch` : '#';
    return `<a href="${link}" target="_blank" class="provider-item" title="${p.provider_name}">
      <img class="provider-logo" src="${TMDB_LOGO_BASE}${p.logo_path}" alt="${escapeHtml(p.provider_name)}" loading="lazy">
      <span class="provider-name">${escapeHtml(p.provider_name)}</span>
    </a>`;
  }

  // Initialize the modal system
  function init(options = {}) {
    currentLang = options.lang || 'ja';
    translations = options.translations || getDefaultTranslations(currentLang);
    callbacks = options.callbacks || {};

    // Set up event listeners
    const modal = document.getElementById('modal');
    const videoModal = document.getElementById('video-modal');

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target.id === 'modal') closeModal();
      });
    }

    if (videoModal) {
      videoModal.addEventListener('click', (e) => {
        if (e.target.id === 'video-modal') closeVideoModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (videoModal && videoModal.classList.contains('active')) {
          closeVideoModal();
        } else {
          closeModal();
        }
      }
    });
  }

  function getDefaultTranslations(lang) {
    if (lang === 'en') {
      return {
        release: 'Release',
        runtime: 'Runtime',
        rating: 'Rating',
        unknown: 'Unknown',
        noOverview: 'No overview available',
        detailedInfo: 'Details',
        budget: 'Budget',
        revenue: 'Revenue',
        viewOnImdb: 'View on IMDb',
        whereToWatch: 'Where to Watch',
        noProviders: 'No streaming information available',
        flatrate: 'Streaming',
        rent: 'Rent',
        buy: 'Buy',
        trailers: 'Trailers',
        cast: 'Cast',
        crew: 'Crew',
        reviews: 'Reviews',
        readMore: 'Read more',
        close: 'Close',
        relatedMovies: 'Related Movies',
        similarMovies: 'Similar Movies (AI)',
        noSimilar: 'No similar movies found',
        watched: 'Watched',
        markWatched: 'Mark as watched',
        whyRecommended: 'Why recommended?',
        loadingReason: 'Analyzing...',
        viewDetails: 'View Details'
      };
    }
    return {
      release: '公開日',
      runtime: '上映時間',
      rating: '評価',
      unknown: '不明',
      noOverview: '概要がありません',
      detailedInfo: '詳細情報',
      budget: '製作費',
      revenue: '興行収入',
      viewOnImdb: 'IMDbで見る',
      whereToWatch: 'どこで見れる',
      noProviders: '配信情報がありません',
      flatrate: '定額',
      rent: 'レンタル',
      buy: '購入',
      trailers: '予告編',
      cast: 'キャスト',
      crew: 'スタッフ',
      reviews: 'レビュー',
      readMore: '続きを読む',
      close: '閉じる',
      relatedMovies: '関連作品',
      similarMovies: '似ている映画 (AI)',
      noSimilar: '似ている映画が見つかりませんでした',
      watched: '見た',
      markWatched: '見たをつける',
      whyRecommended: 'なぜおすすめ？',
      loadingReason: '分析中...',
      viewDetails: '詳細を見る'
    };
  }

  // Open modal with movie data
  async function openModal(id) {
    currentMovieId = id; // Track current movie for similarity reasons

    // Call before-open callback (e.g., trackInteraction)
    if (callbacks.beforeOpen) {
      callbacks.beforeOpen(id);
    }

    try {
      const [fullRes, similarRes] = await Promise.all([
        fetch('/api/movies/' + id + '/full?lang=' + currentLang),
        fetch('/api/movies/' + id + '/similar?limit=6')
      ]);
      const m = await fullRes.json();
      const similarData = await similarRes.json();

      renderModalContent(m, similarData);

      document.getElementById('modal').classList.add('active');
      document.body.style.overflow = 'hidden';

      // Call after-open callback (e.g., loadWatchedStatus)
      if (callbacks.afterOpen) {
        callbacks.afterOpen(id, m);
      }
    } catch (error) {
      console.error('Failed to load movie:', error);
    }
  }

  function renderModalContent(m, similarData) {
    const genres = m.genres ? JSON.parse(m.genres) : [];
    const backdrop = getPoster(m);

    // Backdrop
    document.getElementById('modal-backdrop').src = backdrop;

    // Title
    const mainTitle = getTitle(m);
    document.getElementById('modal-title').textContent = mainTitle;

    // Subtitle (show alternate language title)
    const subTitleEl = document.getElementById('modal-title-ja');
    if (subTitleEl) {
      if (currentLang === 'ja' && m.title && m.title !== m.title_ja) {
        subTitleEl.textContent = m.title;
        subTitleEl.style.display = 'block';
      } else if (currentLang === 'en' && m.title_ja && m.title !== m.title_ja) {
        subTitleEl.textContent = m.title_ja;
        subTitleEl.style.display = 'block';
      } else {
        subTitleEl.style.display = 'none';
      }
    }

    // Tagline
    const taglineEl = document.getElementById('modal-tagline');
    if (taglineEl) {
      if (m.extended?.tagline_ja || m.extended?.tagline) {
        const tagline = currentLang === 'en' ? (m.extended.tagline || m.extended.tagline_ja) : (m.extended.tagline_ja || m.extended.tagline);
        taglineEl.textContent = '"' + tagline + '"';
        taglineEl.style.display = 'block';
      } else {
        taglineEl.style.display = 'none';
      }
    }

    // Genres
    document.getElementById('modal-genres').innerHTML = genres.map(g => '<span class="genre-tag">' + g + '</span>').join('');

    // Meta
    const runtimeText = m.runtime ? m.runtime + (currentLang === 'ja' ? '分' : ' min') : t('unknown');
    document.getElementById('modal-meta').innerHTML = `<span>${t('release')}: ${m.release_date || t('unknown')}</span><span>${t('runtime')}: ${runtimeText}</span><span>${t('rating')}: ★ ${m.vote_average?.toFixed(1) || '-'}</span>`;

    // Overview
    const overview = getOverview(m);
    document.getElementById('modal-overview').textContent = overview || t('noOverview');

    // Extended info
    const extSec = document.getElementById('extended-section');
    const extCon = document.getElementById('extended-content');
    if (extSec && extCon) {
      extSec.querySelector('h3').textContent = t('detailedInfo');
      if (m.extended) {
        let h = '';
        if (m.extended.budget > 0) h += `<div class="extended-item"><div class="extended-label">${t('budget')}</div><div class="extended-value">${formatCurrency(m.extended.budget)}</div></div>`;
        if (m.extended.revenue > 0) h += `<div class="extended-item"><div class="extended-label">${t('revenue')}</div><div class="extended-value">${formatCurrency(m.extended.revenue)}</div></div>`;
        if (m.extended.imdb_id) h += `<div class="extended-item"><div class="extended-label">IMDb</div><div class="extended-value"><a href="https://www.imdb.com/title/${m.extended.imdb_id}" target="_blank">${t('viewOnImdb')}</a></div></div>`;
        if (h) { extCon.innerHTML = h; extSec.style.display = 'block'; } else { extSec.style.display = 'none'; }
      } else {
        extSec.style.display = 'none';
      }
    }

    // Providers
    const wp = m.watchProviders || { flatrate: [], rent: [], buy: [] };
    const provSec = document.getElementById('providers-section');
    const provCon = document.getElementById('providers-content');
    if (provSec && provCon) {
      provSec.querySelector('h3').textContent = t('whereToWatch');
      if (wp.flatrate.length === 0 && wp.rent.length === 0 && wp.buy.length === 0) {
        provCon.innerHTML = `<p class="no-providers">${t('noProviders')}</p>`;
      } else {
        let h = '';
        if (wp.flatrate.length > 0) h += `<div class="provider-group"><div class="provider-group-title">${t('flatrate')}</div><div class="provider-list">${wp.flatrate.map(p => renderProvider(p, m.tmdb_id)).join('')}</div></div>`;
        if (wp.rent.length > 0) h += `<div class="provider-group"><div class="provider-group-title">${t('rent')}</div><div class="provider-list">${wp.rent.map(p => renderProvider(p, m.tmdb_id)).join('')}</div></div>`;
        if (wp.buy.length > 0) h += `<div class="provider-group"><div class="provider-group-title">${t('buy')}</div><div class="provider-list">${wp.buy.map(p => renderProvider(p, m.tmdb_id)).join('')}</div></div>`;
        provCon.innerHTML = h;
      }
    }

    // Videos
    const videos = m.videos || [];
    const vidSec = document.getElementById('videos-section');
    const vidCon = document.getElementById('videos-content');
    if (vidSec && vidCon) {
      vidSec.querySelector('h3').textContent = t('trailers');
      if (videos.length > 0) {
        vidCon.innerHTML = videos.map(v => {
          const videoKey = (currentLang === 'en' && v.video_key_en) ? v.video_key_en : v.video_key;
          const videoName = (currentLang === 'en' && v.name_en) ? v.name_en : v.name;
          return `<div class="video-item" onclick="MovieModal.openVideoModal('${videoKey}')"><img class="video-thumbnail" src="https://img.youtube.com/vi/${videoKey}/mqdefault.jpg" alt=""><p class="video-name">${videoName}</p><span class="video-type-badge">${v.video_type}</span></div>`;
        }).join('');
        vidSec.style.display = 'block';
      } else {
        vidSec.style.display = 'none';
      }
    }

    // Cast
    const cast = m.credits?.cast || [];
    const castSec = document.getElementById('cast-section');
    const castCon = document.getElementById('cast-content');
    if (castSec && castCon) {
      castSec.querySelector('h3').textContent = t('cast');
      if (cast.length > 0) {
        castCon.innerHTML = cast.map(c => {
          const photo = c.profile_path ? TMDB_PROFILE_BASE + c.profile_path : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23333' width='100' height='100'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%23666' font-size='30'%3E%F0%9F%91%A4%3C/text%3E%3C/svg%3E";
          const displayName = (currentLang === 'en' && c.name_en) ? c.name_en : c.name;
          return `<div class="cast-item"><img class="cast-photo" src="${photo}" alt="${escapeHtml(displayName)}" loading="lazy"><p class="cast-name">${escapeHtml(displayName)}</p><p class="cast-character">${escapeHtml(c.character || '')}</p></div>`;
        }).join('');
        castSec.style.display = 'block';
      } else {
        castSec.style.display = 'none';
      }
    }

    // Crew
    const crew = m.credits?.crew || [];
    const crewSec = document.getElementById('crew-section');
    const crewCon = document.getElementById('crew-content');
    if (crewSec && crewCon) {
      crewSec.querySelector('h3').textContent = t('crew');
      if (crew.length > 0) {
        crewCon.innerHTML = crew.map(c => {
          const displayName = (currentLang === 'en' && c.name_en) ? c.name_en : c.name;
          return `<div class="crew-item"><div class="crew-job">${escapeHtml(c.job)}</div><div class="crew-name">${escapeHtml(displayName)}</div></div>`;
        }).join('');
        crewSec.style.display = 'block';
      } else {
        crewSec.style.display = 'none';
      }
    }

    // Reviews
    const reviews = m.reviews || [];
    const revSec = document.getElementById('reviews-section');
    const revCon = document.getElementById('reviews-content');
    if (revSec && revCon) {
      revSec.querySelector('h3').textContent = t('reviews');
      if (reviews.length > 0) {
        revCon.innerHTML = reviews.map(r => `<div class="review-item"><div class="review-header"><span class="review-author">${r.author}</span>${r.rating ? '<span class="review-rating">★ ' + r.rating + '</span>' : ''}</div><p class="review-content">${r.content}</p>${r.content.length > 200 ? '<button class="review-toggle" onclick="MovieModal.toggleReview(this)">' + t('readMore') + '</button>' : ''}</div>`).join('');
        revSec.style.display = 'block';
      } else {
        revSec.style.display = 'none';
      }
    }

    // TMDB Similar movies
    const tmdbSimilar = m.tmdbSimilar || [];
    const tmdbSec = document.getElementById('tmdb-similar-section');
    const tmdbCon = document.getElementById('tmdb-similar-content');
    if (tmdbSec && tmdbCon) {
      tmdbSec.querySelector('h3').textContent = t('relatedMovies');
      if (tmdbSimilar.length > 0) {
        tmdbCon.innerHTML = tmdbSimilar.map(sm => {
          const p = getPoster(sm);
          const smTitle = getTitle(sm);
          return `<div class="similar-movie" onclick="MovieModal.openModal(${sm.id})"><img src="${p}" alt="${escapeHtml(smTitle)}" loading="lazy"><p>${escapeHtml(smTitle)}</p></div>`;
        }).join('');
        tmdbSec.style.display = 'block';
      } else {
        tmdbSec.style.display = 'none';
      }
    }

    // AI Similar movies
    const similarMovies = similarData?.movies || [];
    const similarSec = document.querySelector('.similar-section');
    const similarCon = document.getElementById('similar-movies');
    if (similarSec && similarCon) {
      similarSec.querySelector('h3').textContent = t('similarMovies');
      similarCon.innerHTML = similarMovies.map(sm => {
        const p = getPoster(sm);
        const smTitle = getTitle(sm);
        return `<div class="similar-movie" onclick="MovieModal.openModal(${sm.id})">
          <img src="${p}" alt="${escapeHtml(smTitle)}" loading="lazy">
          <p>${escapeHtml(smTitle)}</p>
        </div>`;
      }).join('') || `<p style="color:#888">${t('noSimilar')}</p>`;
    }

    // Fetch recommendation reason for this movie
    fetchRecommendationReason(currentMovieId);
  }

  // Fetch structured recommendation reasons (based on actual algorithm data)
  async function fetchRecommendationReason(movieId) {
    const section = document.getElementById('recommendation-reason-section');
    const box = document.getElementById('recommendation-reason-box');
    if (!section || !box) return;

    // Show loading state
    section.style.display = 'block';
    box.innerHTML = `<div class="recommendation-loading"><span class="loading-spinner"></span> ${currentLang === 'en' ? 'Analyzing...' : '分析中...'}</div>`;

    try {
      // Use global getAuthHeaders if available (from page-specific JS)
      const headers = typeof getAuthHeaders === 'function' ? await getAuthHeaders() : {};

      const res = await fetch(`/api/movies/${movieId}/recommendation-reason?lang=${currentLang}`, { headers });
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Render structured reasons as a list
      const reasons = data.reasons || [];
      if (reasons.length === 0) {
        section.style.display = 'none';
        return;
      }

      const personalizedClass = data.isPersonalized ? 'personalized' : '';

      // Build reasons list HTML
      const reasonsHtml = reasons.map(r => {
        const iconClass = getReasonIconClass(r.type);
        return `
          <li class="recommendation-reason-item ${r.type}">
            <span class="reason-icon ${iconClass}">${r.icon}</span>
            <span class="reason-text">${escapeHtml(r.text)}</span>
          </li>
        `;
      }).join('');

      box.innerHTML = `
        <div class="recommendation-header ${personalizedClass}">
          <span class="recommendation-icon">${data.isPersonalized ? '🎯' : '💡'}</span>
          <span class="recommendation-title">${currentLang === 'en' ? 'Why this movie?' : 'なぜこの映画？'}</span>
        </div>
        <ul class="recommendation-reasons-list">
          ${reasonsHtml}
        </ul>
      `;
    } catch (error) {
      console.error('Failed to fetch recommendation reason:', error);
      section.style.display = 'none';
    }
  }

  // Get CSS class for reason type icon styling
  function getReasonIconClass(type) {
    switch (type) {
      case 'similar_to_favorite': return 'icon-favorite';
      case 'similar_to_high_rated': return 'icon-rated';
      case 'genre_match': return 'icon-genre';
      case 'same_director': return 'icon-director';
      case 'same_cast': return 'icon-cast';
      default: return 'icon-default';
    }
  }

  function closeModal() {
    document.getElementById('modal').classList.remove('active');
    document.body.style.overflow = '';
    currentMovieId = null;
  }

  function openVideoModal(key) {
    const iframe = document.getElementById('video-iframe');
    if (iframe) {
      iframe.src = 'https://www.youtube.com/embed/' + key + '?autoplay=1';
      document.getElementById('video-modal').classList.add('active');
    } else {
      // Fallback: open in new tab
      window.open('https://www.youtube.com/watch?v=' + key, '_blank');
    }
  }

  function closeVideoModal() {
    const iframe = document.getElementById('video-iframe');
    if (iframe) {
      iframe.src = '';
    }
    document.getElementById('video-modal').classList.remove('active');
  }

  function toggleReview(btn) {
    const c = btn.previousElementSibling;
    c.classList.toggle('expanded');
    btn.textContent = c.classList.contains('expanded') ? t('close') : t('readMore');
  }

  function setLanguage(lang) {
    currentLang = lang;
    translations = getDefaultTranslations(lang);
  }

  // Public API
  return {
    init,
    openModal,
    closeModal,
    openVideoModal,
    closeVideoModal,
    toggleReview,
    setLanguage,
    escapeHtml,
    getTitle,
    getPoster,
    getOverview,
    t,
    formatCurrency,
    renderProvider
  };
})();
