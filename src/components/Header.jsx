import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { io } from "socket.io-client";
import { AuthContext } from "../context/AuthContext";
import Api from "../common/SummaryAPI";
import gashLogo from "../assets/image/gash-logo.svg";
import { SEARCH_DEBOUNCE_DELAY, API_RETRY_COUNT, API_RETRY_DELAY } from "../constants/constants";

// Material UI Icons
import PermIdentityOutlinedIcon from '@mui/icons-material/PermIdentityOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import TvOutlinedIcon from '@mui/icons-material/TvOutlined';
import NotificationsDropdown from "./NotificationsDropdown";
import IconButton from "./IconButton";

const fetchWithRetry = async (apiCall, retries = API_RETRY_COUNT, delay = API_RETRY_DELAY) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await apiCall();
            return response.data;
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
        }
    }
};

// Custom events for updates
const CART_UPDATE_EVENT = 'cartUpdated';
const NOTIFICATION_UPDATE_EVENT = 'notificationUpdated';
const LIVESTREAM_UPDATE_EVENT = 'livestreamUpdated';

export default function Header() {
    const { user, logout } = useContext(AuthContext);
    const [search, setSearch] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
    const [cartItemCount, setCartItemCount] = useState(0);
    const [notificationCount, setNotificationCount] = useState(0);
    const [livestreamCount, setLivestreamCount] = useState(0);
    const [favoriteCount, setFavoriteCount] = useState(0);

    const navigate = useNavigate();
    const location = useLocation();
    const dropdownRef = useRef(null);
    const userMenuRef = useRef(null);
    const fetchTimeoutRef = useRef({ cart: null, notification: null, livestream: null, favorite: null });
    const socketRef = useRef(null);

    // Fetch cart item count
    const fetchCartItemCount = useCallback(async () => {
        if (!user) {
            setCartItemCount(0);
            return;
        }
        try {
            const cartData = await fetchWithRetry(() =>
                Api.newCart.getByAccount(user._id, user.token)
            );

            // NEW: count *different* products only
            const itemCount = Array.isArray(cartData.data)
                ? cartData.data.filter(item => (item.productQuantity ?? 0) > 0).length
                : 0;

            setCartItemCount(itemCount);
        } catch (error) {
            setCartItemCount(0);
        }
    }, [user]);

    // Fetch notification count
    const fetchNotificationCount = useCallback(async () => {
        if (!user) {
            setNotificationCount(0);
            return;
        }
        try {
            const notificationData = await fetchWithRetry(() =>
                Api.newNotifications.getByAccount(user._id, user.token)
            );
            const unreadCount = Array.isArray(notificationData.data)
                ? notificationData.data.filter(item => !item.isRead).length
                : 0;
            setNotificationCount(unreadCount);
        } catch (error) {
            setNotificationCount(0);
        }
    }, [user]);

    // Fetch livestream count
    const fetchLivestreamCount = useCallback(async () => {
        if (!user) {
            setLivestreamCount(0);
            return;
        }
        try {
            const livestreamData = await fetchWithRetry(() =>
                Api.livestream.getLive(user.token)
            );
            const activeCount = livestreamData.data?.count || 0;
            setLivestreamCount(activeCount);
        } catch (error) {
            setLivestreamCount(0);
        }
    }, [user]);

    // Fetch favorite count
    const fetchFavoriteCount = useCallback(async () => {
        if (!user) {
            setFavoriteCount(0);
            return;
        }
        try {
            const favoritesData = await fetchWithRetry(() =>
                Api.favorites.fetch(user.token)
            );
            const itemCount = Array.isArray(favoritesData) ? favoritesData.length : 0;
            setFavoriteCount(itemCount);
        } catch (error) {
            setFavoriteCount(0);
        }
    }, [user]);

    // Debounced fetch functions
    const debouncedFetchCartItemCount = useCallback(() => {
        if (fetchTimeoutRef.current.cart) clearTimeout(fetchTimeoutRef.current.cart);
        fetchTimeoutRef.current.cart = setTimeout(fetchCartItemCount, 10);
    }, [fetchCartItemCount]);

    const debouncedFetchNotificationCount = useCallback(() => {
        if (fetchTimeoutRef.current.notification) clearTimeout(fetchTimeoutRef.current.notification);
        fetchTimeoutRef.current.notification = setTimeout(fetchNotificationCount, 10);
    }, [fetchNotificationCount]);

    const debouncedFetchLivestreamCount = useCallback(() => {
        if (fetchTimeoutRef.current.livestream) clearTimeout(fetchTimeoutRef.current.livestream);
        fetchTimeoutRef.current.livestream = setTimeout(fetchLivestreamCount, 10);
    }, [fetchLivestreamCount]);

    const debouncedFetchFavoriteCount = useCallback(() => {
        if (fetchTimeoutRef.current.favorite) clearTimeout(fetchTimeoutRef.current.favorite);
        fetchTimeoutRef.current.favorite = setTimeout(fetchFavoriteCount, 10);
    }, [fetchFavoriteCount]);

    // 🔔 Socket.IO: Setup real-time updates for badges
    useEffect(() => {
        if (!user?._id) {
            // Disconnect socket if user logs out
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
            return;
        }

        // Get backend URL
        const baseURL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "http://localhost:5000";
        
        // Connect to Socket.IO
        const socket = io(baseURL, {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 2000,
            withCredentials: true,
        });

        socketRef.current = socket;

        // Join user's room for targeted updates
        socket.on("connect", () => {
            socket.emit("userConnected", user._id);
            socket.emit("joinRoom", user._id);
        });

        // Listen for cart updates
        socket.on("cartUpdated", (data) => {
            // Immediately fetch updated cart count
            debouncedFetchCartItemCount();
        });

        // Listen for livestream count changes
        socket.on("livestreamCountChanged", (data) => {
            // Update livestream count directly if count is provided, otherwise fetch
            if (typeof data.count === 'number') {
                setLivestreamCount(data.count);
            } else {
                debouncedFetchLivestreamCount();
            }
        });

        // Listen for notification updates (already handled by NotificationsDropdown, but keep for consistency)
        socket.on("newNotification", () => {
            debouncedFetchNotificationCount();
        });

        // Listen for notification badge updates (when notifications are marked as read/deleted)
        socket.on("notificationBadgeUpdate", (data) => {
            // Only update if it's for this user or global
            if (!data.userId || data.userId === user._id) {
                debouncedFetchNotificationCount();
            }
        });

        // Listen for favorite updates
        socket.on("favoriteUpdated", (data) => {
            // Immediately fetch updated favorite count
            debouncedFetchFavoriteCount();
        });

        socket.on("connect_error", (err) => {
            console.error("Header Socket connection error:", err.message);
        });

        socket.on("disconnect", (reason) => {
            console.warn("⚠️ Header Socket disconnected:", reason);
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [user, debouncedFetchCartItemCount, debouncedFetchNotificationCount, debouncedFetchLivestreamCount, debouncedFetchFavoriteCount]);

    // Fetch counts on mount, location change, or update events
    useEffect(() => {

        fetchCartItemCount();
        fetchNotificationCount();   // guaranteed to run
        fetchLivestreamCount();
        fetchFavoriteCount();

        // ---- 2. EVENT LISTENERS (debounced) - Keep for backward compatibility ----
        const handleCartUpdate = () => debouncedFetchCartItemCount();
        const handleNotificationUpdate = () => debouncedFetchNotificationCount();
        const handleLivestreamUpdate = () => debouncedFetchLivestreamCount();

        window.addEventListener(CART_UPDATE_EVENT, handleCartUpdate);
        window.addEventListener(NOTIFICATION_UPDATE_EVENT, handleNotificationUpdate);
        window.addEventListener(LIVESTREAM_UPDATE_EVENT, handleLivestreamUpdate);

        // ---- 3. POLLING (fallback, reduced frequency - every 30s instead of 3s) ----
        let pollInterval;
        if (user) {
            pollInterval = setInterval(() => {
                fetchCartItemCount();        // raw
                fetchNotificationCount();    // raw
                fetchLivestreamCount();      // raw
                fetchFavoriteCount();        // raw
            }, 30000); // Increased from 3000 to 30000 (30 seconds) as fallback
        }

        // Also listen for custom events for backward compatibility
        const FAVORITE_UPDATE_EVENT = 'favoriteUpdated';
        const handleFavoriteUpdate = () => debouncedFetchFavoriteCount();
        window.addEventListener(FAVORITE_UPDATE_EVENT, handleFavoriteUpdate);

        return () => {
            window.removeEventListener(CART_UPDATE_EVENT, handleCartUpdate);
            window.removeEventListener(NOTIFICATION_UPDATE_EVENT, handleNotificationUpdate);
            window.removeEventListener(LIVESTREAM_UPDATE_EVENT, handleLivestreamUpdate);
            window.removeEventListener(FAVORITE_UPDATE_EVENT, handleFavoriteUpdate);
            clearInterval(pollInterval);
            Object.values(fetchTimeoutRef.current).forEach(t => t && clearTimeout(t));
        };
    }, [
        fetchCartItemCount,
        fetchNotificationCount,
        fetchLivestreamCount,
        fetchFavoriteCount,
        debouncedFetchCartItemCount,
        debouncedFetchNotificationCount,
        debouncedFetchLivestreamCount,
        debouncedFetchFavoriteCount,
        location,
        user
    ]);       
    
    useEffect(() => {
        setSearch("");
        setSearchResults([]);
        setShowDropdown(false);
        setShowUserMenu(false);
        setMobileSearchOpen(false);
    }, [location]);

    const handleLogout = async () => {
        try {
            await logout();
            navigate("/");
        } catch (err) {
        }
    };

    const getMinPrice = (product) => {
        if (!product.productVariantIds || product.productVariantIds.length === 0) {
            return 0;
        }
        const prices = product.productVariantIds
            .filter(v => v.variantStatus !== 'discontinued' && v.variantPrice > 0)
            .map(v => v.variantPrice);
        return prices.length > 0 ? Math.min(...prices) : 0;
    };

    const getMainImageUrl = (product) => {
        if (!product.productImageIds || product.productImageIds.length === 0) {
            return "/placeholder-image.png";
        }
        const mainImage = product.productImageIds.find(img => img.isMain);
        const imageUrl = mainImage?.imageUrl || product.productImageIds[0]?.imageUrl || "/placeholder-image.png";
        return imageUrl;
    };

    const fetchSearchResults = useCallback(async (query) => {
        if (!query.trim()) {
            setSearchResults([]);
            setShowDropdown(false);
            return;
        }
        const sanitizedQuery = query.trim().replace(/[<>]/g, "");
        try {
            setLoading(true);
            const productsData = await fetchWithRetry(() =>
                Api.newProducts.search({ name: sanitizedQuery, status: "active" })
            );
            const productsArray = Array.isArray(productsData.data) ? productsData.data : [];
            const filteredProducts = productsArray.filter(
                (product) => product.productVariantIds?.length > 0
            );
            setSearchResults(filteredProducts);
            setShowDropdown(true);
        } catch (err) {
            setSearchResults([]);
            setShowDropdown(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!search.trim()) {
            setSearchResults([]);
            setShowDropdown(false);
            return;
        }
        const debounce = setTimeout(() => fetchSearchResults(search), SEARCH_DEBOUNCE_DELAY);
        return () => clearTimeout(debounce);
    }, [search, fetchSearchResults]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (search.trim()) {
            navigate(`/search?q=${encodeURIComponent(search)}`);
            setShowDropdown(false);
            setMobileSearchOpen(false);
        }
    };

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
                setShowUserMenu(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const formatPrice = (price) => {
        if (!price) {
            return "";
        }
        return `${price.toLocaleString()} ₫`;
    };

    const getFirstName = (name) => {
        if (!name) return "User";
        const firstWord = name.trim().split(" ")[0];
        return firstWord || "User";
    };

    // Reusable badge class
    const badgeClass = "absolute bg-amber-500 text-white text-xs font-semibold rounded-full h-5 w-5 flex items-center justify-center";

    return (
        <nav className="fixed top-0 left-0 w-full z-50 bg-[#131921] text-white shadow">
            <div className="max-w-7xl mx-auto h-16 sm:h-20 md:h-24 flex items-center px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12">
                {/* ==== MOBILE HEADER ==== */}
                <div className="flex w-full items-center justify-between sm:hidden">
                    {mobileSearchOpen ? (
                        <div className="relative w-full">
                            <form
                                onSubmit={handleSearchSubmit}
                                className="flex items-center w-full bg-white rounded-full shadow-sm border border-gray-200 overflow-hidden relative"
                            >
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => {
                                        setSearch(e.target.value);
                                    }}
                                    placeholder="Search..."
                                    autoFocus
                                    className="flex-1 pl-3 pr-10 sm:pr-12 py-2 text-sm sm:text-base text-gray-900 focus:outline-none"
                                />
                                {search ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearch("");
                                        }}
                                        className="absolute right-2 p-2 text-gray-500 hover:text-red-500"
                                    >
                                        <CloseIcon fontSize="small" />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setMobileSearchOpen(false);
                                        }}
                                        className="absolute right-2 p-2 text-gray-600 hover:text-red-500"
                                    >
                                        <CloseIcon fontSize="small" />
                                    </button>
                                )}
                            </form>
                            {showDropdown && (
                                <div className="absolute top-full left-0 mt-2 w-full rounded-xl shadow-lg z-50 bg-white 
                                border border-gray-200 overflow-hidden animate-[fadeIn_0.2s_ease-out]
                                max-h-96 overflow-y-auto">
                                    {loading ? (
                                        <div className="flex items-center justify-center gap-2 py-4 text-gray-500">
                                            <span className="animate-spin border-2 border-gray-300 border-t-transparent rounded-full w-5 h-5"></span>
                                            Searching...
                                        </div>
                                    ) : searchResults.length > 0 ? (
                                        <>
                                            {searchResults.map((item) => {
                                                const minPrice = getMinPrice(item);
                                                const imageUrl = getMainImageUrl(item);
                                                return (
                                                    <Link
                                                        key={item._id}
                                                        to={`/product/${item._id}`}
                                                        className="flex items-center gap-3 px-4 py-3 hover:bg-[#ffb300]/20 transition-colors border-b last:border-0"
                                                        onClick={() => {
                                                            setShowDropdown(false);
                                                        }}
                                                    >
                                                        <img
                                                            src={imageUrl}
                                                            alt={item.productName || "Product image"}
                                                            className="w-14 h-14 rounded-lg object-cover shadow-sm"
                                                        />
                                                        <div className="flex flex-col">
                                                            <p className="text-sm font-medium text-gray-900 line-clamp-1">
                                                                {item.productName || "Unnamed Product"}
                                                            </p>
                                                            <p className="text-sm text-red-600 font-semibold mt-1">
                                                                {formatPrice(minPrice)}
                                                            </p>
                                                        </div>
                                                    </Link>
                                                );
                                            })}
                                            <button
                                                onClick={() => {
                                                    navigate(`/search?q=${encodeURIComponent(search)}`);
                                                    setShowDropdown(false);
                                                }}
                                                className="w-full text-center text-sm font-medium text-amber-600 py-2 hover:bg-[#ffb300]/20 transition-colors"
                                            >
                                                View all results
                                            </button>
                                        </>
                                    ) : (
                                        <div className="px-4 py-4 text-gray-500 text-center">No products found</div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={() => {
                                    setMobileSearchOpen(true);
                                }}
                                title="Search"
                                className="p-2 text-white hover:text-amber-500 transition-colors duration-200 ease-in-out"
                            >
                                <SearchIcon />
                            </button>
                            <Link to="/" className="flex items-center justify-center">
                                <img src={gashLogo} alt="GASH Logo" className="h-6 sm:h-7" />
                            </Link>
                            <div className="relative" ref={userMenuRef}>
                                <button
                                    onClick={() => {
                                        if (!user) {
                                            navigate("/login");
                                        } else {
                                            setShowUserMenu((prev) => !prev);
                                        }
                                    }}
                                    title="My Account"
                                    className="p-2 text-white hover:text-amber-500 transition-colors duration-200 ease-in-out"
                                >
                                    <PermIdentityOutlinedIcon />
                                </button>
                                {user && showUserMenu && (
                                    <div className="absolute right-0 mt-2 w-44 bg-white text-gray-900 rounded-xl shadow-lg overflow-hidden animate-[fadeDown_0.25s_ease-out] z-50">
                                        <div className="px-4 py-2 hover:bg-[#ffb300]/20">
                                            <NotificationsDropdown user={user} />
                                        </div>
                                        <button
                                            onMouseDown={(e) => {
                                                e.stopPropagation();
                                                navigate('/cart');
                                                setShowUserMenu(false);
                                            }}
                                            className="flex items-center gap-2 w-full text-left px-4 py-2 hover:bg-[#ffb300]/20 relative"
                                        >
                                            <ShoppingBagOutlinedIcon fontSize="small" />
                                            Cart
                                            {cartItemCount > 0 && (
                                                <span className={`${badgeClass} top-1 right-4`}>
                                                    {cartItemCount}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            onMouseDown={(e) => {
                                                e.stopPropagation();
                                                navigate('/notifications');
                                                setShowUserMenu(false);
                                            }}
                                            className="flex items-center gap-2 w-full text-left px-4 py-2 hover:bg-[#ffb300]/20 relative"
                                        >
                                            <NotificationsOutlinedIcon fontSize="small" />
                                            Notifications
                                            {notificationCount > 0 && (
                                                <span className={`${badgeClass} top-1 right-4`}>
                                                    {notificationCount}
                                                </span>
                                            )}
                                        </button>
                                        <Link
                                            to="/profile"
                                            className="flex items-center gap-2 w-full text-left px-4 py-2 hover:bg-[#ffb300]/20"
                                        >
                                            <button
                                                onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                    navigate('/profile');
                                                    setShowUserMenu(false);
                                                }}
                                                className="flex items-center gap-2 w-full text-left"
                                            >
                                                <PermIdentityOutlinedIcon fontSize="small" /> My Account
                                            </button>
                                        </Link>
                                        <button
                                            onMouseDown={(e) => {
                                                e.stopPropagation();
                                                handleLogout();
                                                setShowUserMenu(false);
                                            }}
                                            className="flex items-center gap-2 w-full text-left px-4 py-2 text-red-600 hover:bg-red-50"
                                        >
                                            Sign Out
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* ==== DESKTOP HEADER ==== */}
                <div className="hidden sm:flex w-full items-center justify-between">
                    <Link to="/" className="flex items-center gap-2">
                        <img src={gashLogo} alt="GASH Logo" className="h-6 md:h-7" />
                    </Link>
                    <div className="relative flex-1 mx-4 sm:mx-6 md:mx-8 lg:mx-12 max-w-2xl" ref={dropdownRef}>
                        <form
                            onSubmit={handleSearchSubmit}
                            className="flex items-center w-full bg-white rounded-full shadow-sm border border-gray-200 overflow-hidden"
                        >
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                }}
                                placeholder="Search products..."
                                className="flex-1 pl-3 sm:pl-4 md:pl-5 pr-10 sm:pr-12 py-1.5 sm:py-2 text-sm sm:text-base text-gray-900 focus:outline-none"
                            />
                            <button type="submit" className="p-2 mr-2 text-gray-600 hover:text-amber-500 transition-colors duration-200 ease-in-out">
                                <SearchIcon fontSize="small" />
                            </button>
                        </form>
                        {showDropdown && (
                            <div className="absolute top-full left-0 mt-2 w-full rounded-xl shadow-lg z-50 bg-white border border-gray-200 overflow-hidden animate-[fadeIn_0.2s_ease-out] max-h-96 overflow-y-auto">
                                {loading ? (
                                    <div className="flex items-center justify-center gap-2 py-4 text-gray-500">
                                        <span className="animate-spin border-2 border-gray-300 border-t-transparent rounded-full w-5 h-5"></span>
                                        Searching...
                                    </div>
                                ) : searchResults.length > 0 ? (
                                    <>
                                        {searchResults.map((item) => {
                                            const minPrice = getMinPrice(item);
                                            const imageUrl = getMainImageUrl(item);
                                            return (
                                                <Link
                                                    key={item._id}
                                                    to={`/product/${item._id}`}
                                                    className="flex items-center gap-3 px-4 py-3 hover:bg-[#ffb300]/20 transition-colors border-b last:border-0"
                                                    onClick={() => {
                                                        setShowDropdown(false);
                                                    }}
                                                >
                                                    <img
                                                        src={imageUrl}
                                                        alt={item.productName || "Product image"}
                                                        className="w-14 h-14 rounded-lg object-cover shadow-sm"
                                                    />
                                                    <div className="flex flex-col">
                                                        <p className="text-sm font-medium text-gray-900 line-clamp-1">
                                                            {item.productName || "Unnamed Product"}
                                                        </p>
                                                        <p className="text-sm text-red-600 font-semibold mt-1">
                                                            {formatPrice(minPrice)}
                                                        </p>
                                                    </div>
                                                </Link>
                                            );
                                        })}
                                        <button
                                            onClick={() => {
                                                navigate(`/search?q=${encodeURIComponent(search)}`);
                                                setShowDropdown(false);
                                            }}
                                            className="w-full text-center text-sm font-medium text-amber-600 py-2 hover:bg-[#ffb300]/20 transition-colors"
                                        >
                                            View all results
                                        </button>
                                    </>
                                ) : (
                                    <div className="px-4 py-4 text-gray-500 text-center">No products found</div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 md:gap-4 lg:gap-6" ref={userMenuRef}>
                        <div className="relative">
                            <button
                                onClick={async () => {
                                    try {
                                        const token = localStorage.getItem('token');
                                        if (!token) {
                                            navigate("/login");
                                            return;
                                        }
                                        
                                        const response = await Api.livestream.getLiveNow(token);
                                        
                                        if (response.data?.success) {
                                            let streams = [];
                                            
                                            if (response.data?.data?.livestreams && Array.isArray(response.data.data.livestreams)) {
                                                streams = response.data.data.livestreams.filter(s => s && s.status === 'live');
                                            } else if (response.data?.data?.livestream) {
                                                const livestream = response.data.data.livestream;
                                                if (livestream && livestream.status === 'live') {
                                                    streams = [livestream];
                                                }
                                            }
                                            
                                            if (streams.length > 0) {
                                                // Navigate to the first live stream
                                                navigate(`/live/${streams[0]._id}`);
                                            } else {
                                                // No live streams available, navigate to list page
                                                navigate("/live");
                                            }
                                        } else {
                                            // Fallback to list page if API fails
                                            navigate("/live");
                                        }
                                    } catch (error) {
                                        console.error("Error fetching live streams:", error);
                                        // Fallback to list page on error
                                        navigate("/live");
                                    }
                                }}
                                title="Live Stream"
                                className="p-2 text-white hover:text-amber-500 transition-colors duration-200 ease-in-out"
                            >
                                <TvOutlinedIcon />
                                {livestreamCount > 0 && (
                                    <span className={`${badgeClass} -top-1 -right-1`}>
                                        {livestreamCount}
                                    </span>
                                )}
                            </button>
                        </div>
                        <div className="relative">
                            <IconButton
                                onClick={() => {
                                    user ? navigate("/favorites") : navigate("/login");
                                }}
                                title="Favorites"
                                badge={favoriteCount > 0 ? favoriteCount : undefined}
                                badgeColor="bg-amber-500"
                            >
                                <FavoriteBorderIcon />
                            </IconButton>
                        </div>
                        <div className="relative">
                            <button
                                onClick={() => {
                                    user ? navigate("/cart") : navigate("/login");
                                }}
                                title="Cart"
                                className="p-2 text-white hover:text-amber-500 transition-colors duration-200 ease-in-out"
                            >
                                <ShoppingBagOutlinedIcon />
                                {cartItemCount > 0 && (
                                    <span className={`${badgeClass} -top-1 -right-1`}>
                                        {cartItemCount}
                                    </span>
                                )}
                            </button>
                        </div>
                        {user ? (
                            <div className="relative">
                                <NotificationsDropdown user={user} />
                                {notificationCount > 0 && (
                                    <span className={`${badgeClass} -top-1 -right-1`}>
                                        {notificationCount}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="relative">
                                <button
                                    onClick={() => {
                                        navigate("/login");
                                    }}
                                    title="Notifications"
                                    className="p-2 text-white hover:text-amber-500 transition-colors duration-200 ease-in-out"
                                >
                                    <NotificationsOutlinedIcon />
                                </button>
                            </div>
                        )}
                        <div className="relative flex items-center gap-2 cursor-pointer" onClick={() => {
                            user ? setShowUserMenu((prev) => !prev) : navigate("/login");
                        }}>
                            <button
                                title="My Account"
                                className="p-2 text-white hover:text-amber-500 transition-colors duration-200 ease-in-out"
                            >
                                <PermIdentityOutlinedIcon />
                            </button>
                            {user && (
                                <span className="hidden md:block text-xs md:text-sm text-gray-200">
                                    <span className="font-semibold text-white">{getFirstName(user?.name)}</span>
                                </span>
                            )}
                            {user && showUserMenu && (
                                <div className="absolute right-0 top-full mt-2 w-44 bg-white text-gray-900 rounded-xl shadow-lg overflow-hidden animate-[fadeDown_0.25s_ease-out] z-50">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate("/profile");
                                            setShowUserMenu(false);
                                        }}
                                        className="w-full text-left px-4 py-2 hover:bg-[#ffb300]/20 transition-colors"
                                    >
                                        My Account
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate("/orders");
                                            setShowUserMenu(false);
                                        }}
                                        className="w-full text-left px-4 py-2 hover:bg-[#ffb300]/20 transition-colors"
                                    >
                                        My Orders
                                    </button>
                                    {/* <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigate("/feedback");
                                            setShowUserMenu(false);
                                        }}
                                        className="w-full text-left px-4 py-2 hover:bg-[#ffb300]/20 transition-colors"
                                    >
                                        My Feedback
                                    </button> */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleLogout();
                                            setShowUserMenu(false);
                                        }}
                                        className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 transition-colors"
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
}