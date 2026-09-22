/**
 * Shared Watchlist Module for OTTflix
 * Used by both index.html and chat.html
 */

const MovieWatchlist = (function() {
  let currentUser = null;
  let currentLang = 'ja';
  let getAuthHeadersFn = null;
  let currentModalMovieId = null;
  let currentModalMovieTitle = null;
  let currentWatchlistData = null;
  let callbacks = {
    onWatchlistAdded: null,
    onWatchlistRemoved: null,
    onAuthExpired: null
  };

  /**
   * Initialize the watchlist module
   * @param {Object} options - Configuration options
   * @param {Object} options.user - Current user object
   * @param {string} options.lang - Current language ('ja' or 'en')
   * @param {Function} options.getAuthHeaders - Function to get auth headers
   * @param {Object} options.callbacks - Callback functions
   */
  function init(options = {}) {
    currentUser = options.user || null;
    currentLang = options.lang || 'ja';
    getAuthHeadersFn = options.getAuthHeaders || (() => ({}));
    if (options.callbacks) {
      callbacks = { ...callbacks, ...options.callbacks };
    }
  }

  function setUser(user) {
    currentUser = user;
  }

  function setLang(lang) {
    currentLang = lang;
  }

  function setCurrentMovie(movieId, movieTitle) {
    currentModalMovieId = movieId;
    currentModalMovieTitle = movieTitle;
  }

  function getCurrentMovieId() {
    return currentModalMovieId;
  }

  function getCurrentMovieTitle() {
    return currentModalMovieTitle;
  }

  function getWatchlistData() {
    return currentWatchlistData;
  }

  /**
   * Load watchlist status for a movie
   * @param {number|string} movieId - The movie ID
   */
  async function loadStatus(movieId) {
    const wantToWatchBtn = document.getElementById('want-to-watch-btn');
    const removeWantToWatchBtn = document.getElementById('remove-want-to-watch-btn');

    if (!currentUser) {
      if (wantToWatchBtn) wantToWatchBtn.style.display = 'none';
      if (removeWantToWatchBtn) removeWantToWatchBtn.style.display = 'none';
      return;
    }

    if (wantToWatchBtn) wantToWatchBtn.style.display = 'flex';

    try {
      const headers = getAuthHeadersFn ? await getAuthHeadersFn() : {};
      const res = await fetch('/api/watchlist/' + movieId, { headers });

      if (res.status === 401) {
        if (wantToWatchBtn) wantToWatchBtn.style.display = 'none';
        if (removeWantToWatchBtn) removeWantToWatchBtn.style.display = 'none';
        currentWatchlistData = null;
        return;
      }

      const data = await res.json();
      currentWatchlistData = data.inWatchlist ? { movie_id: movieId } : null;
      updateUI();
    } catch (e) {
      console.error('Failed to load watchlist status:', e);
      currentWatchlistData = null;
      updateUI();
    }
  }

  /**
   * Add current movie to watchlist
   */
  async function add() {
    if (!currentUser) {
      alert(currentLang === 'ja' ? 'ログインしてください' : 'Please login first');
      return;
    }

    if (!currentModalMovieId) {
      console.error('No movie ID for want to watch');
      return;
    }

    const movieId = currentModalMovieId;
    const movieTitle = currentModalMovieTitle;

    try {
      const headers = getAuthHeadersFn ? await getAuthHeadersFn() : {};
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify({ movieId: Number(movieId) })
      });

      if (res.ok) {
        currentWatchlistData = { movie_id: movieId };
        updateUI();
        if (callbacks.onWatchlistAdded) {
          callbacks.onWatchlistAdded(Number(movieId), movieTitle);
        }
      } else if (res.status === 401) {
        if (callbacks.onAuthExpired) {
          callbacks.onAuthExpired();
        }
        alert(currentLang === 'ja' ? 'ログインしてください' : 'Please login first');
      } else {
        const errorData = await res.json();
        console.error('Failed to add to watchlist:', res.status, errorData);
      }
    } catch (e) {
      console.error('Failed to add to watchlist:', e);
      alert('Error: ' + e.message);
    }
  }

  /**
   * Remove current movie from watchlist
   */
  async function remove() {
    if (!currentUser || !currentModalMovieId) return;

    const movieId = currentModalMovieId;

    try {
      const headers = getAuthHeadersFn ? await getAuthHeadersFn() : {};
      const res = await fetch('/api/watchlist/' + movieId, {
        method: 'DELETE',
        headers
      });

      if (res.ok) {
        currentWatchlistData = null;
        updateUI();
        if (callbacks.onWatchlistRemoved) {
          callbacks.onWatchlistRemoved(Number(movieId));
        }
      } else if (res.status === 401) {
        if (callbacks.onAuthExpired) {
          callbacks.onAuthExpired();
        }
        alert(currentLang === 'ja' ? 'ログインしてください' : 'Please login first');
      }
    } catch (e) {
      console.error('Failed to remove from watchlist:', e);
    }
  }

  /**
   * Update the watchlist UI based on current state
   */
  function updateUI() {
    const btn = document.getElementById('want-to-watch-btn');
    const btnIcon = document.getElementById('want-to-watch-btn-icon');
    const btnText = document.getElementById('want-to-watch-btn-text');
    const removeBtn = document.getElementById('remove-want-to-watch-btn');

    if (!btn || !btnIcon || !btnText || !removeBtn) {
      console.error('Want to watch UI elements not found');
      return;
    }

    if (currentWatchlistData) {
      btn.classList.add('active');
      btnIcon.textContent = '🩷'; // Pink heart when active
      btnText.textContent = currentLang === 'ja' ? 'みたい' : 'Want to Watch';
      removeBtn.style.display = 'block';
    } else {
      btn.classList.remove('active');
      btnIcon.textContent = '🩷'; // Pink heart
      btnText.textContent = currentLang === 'ja' ? 'みたい' : 'Want to Watch';
      removeBtn.style.display = 'none';
    }
  }

  // Public API
  return {
    init,
    setUser,
    setLang,
    setCurrentMovie,
    getCurrentMovieId,
    getCurrentMovieTitle,
    getWatchlistData,
    loadStatus,
    add,
    remove,
    updateUI
  };
})();

// Global functions for onclick handlers in HTML
function toggleWantToWatch() {
  MovieWatchlist.add();
}

function removeWantToWatch() {
  MovieWatchlist.remove();
}

function loadWatchlistStatus(movieId) {
  MovieWatchlist.loadStatus(movieId);
}
