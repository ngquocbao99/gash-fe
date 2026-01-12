import React, { useState, useEffect, useCallback, useRef } from 'react';
import Api from '../../common/SummaryAPI';
import { useToast } from '../../hooks/useToast';
import { useNavigate } from 'react-router-dom';
import { LiveTv } from '@mui/icons-material';

const LiveStream = () => {
    const navigate = useNavigate();
    const { showToast } = useToast();

    // State
    const [isLoading, setIsLoading] = useState(false);
    const [liveStreams, setLiveStreams] = useState([]);

    // Performance optimization: Cache for API responses
    const apiCacheRef = useRef({
        liveNow: null,
    });
    const CACHE_TTL = 4000; // 4 seconds (matching backend cache)

    // Track ongoing API calls to prevent duplicate requests
    const ongoingCallsRef = useRef({
        getLiveNow: false,
        checkStatus: false,
    });

    // Load live streams function (optimized with caching)
    const loadLiveStreams = useCallback(async (forceRefresh = false) => {
        try {
            // Check cache first (reduce API calls)
            const cached = apiCacheRef.current.liveNow;
            if (!forceRefresh && cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
                setLiveStreams(cached.data);
                return;
            }

            setIsLoading(true);
            const token = localStorage.getItem('token');

            if (!token) {
                showToast('Please login to view livestream', 'error');
                return;
            }

            // Prevent duplicate calls
            if (ongoingCallsRef.current.getLiveNow) {
                return;
            }
            ongoingCallsRef.current.getLiveNow = true;

            try {
                const response = await Api.livestream.getLiveNow(token);

                if (response.data?.success) {
                    // Backend may return: { success: true, data: { livestream: {...} } } or { livestreams: [...] }
                    let streams = [];

                    if (response.data?.data?.livestreams && Array.isArray(response.data.data.livestreams)) {
                        // Array format
                        streams = response.data.data.livestreams.filter(s => s && s.status === 'live');
                    } else if (response.data?.data?.livestream) {
                        // Single object format - convert to array
                        const livestream = response.data.data.livestream;
                        if (livestream && livestream.status === 'live') {
                            streams = [livestream];
                        }
                    }

                    // Cache the result
                    apiCacheRef.current.liveNow = {
                        data: streams,
                        timestamp: Date.now()
                    };

                    setLiveStreams(streams);
                    if (forceRefresh) {
                        showToast(`Successfully loaded ${streams.length} stream(s)`, 'success');
                    }
                } else {
                    if (forceRefresh) {
                        showToast(`API Error: ${response.data?.message || 'Unknown error'}`, 'error');
                    }
                    // Use cached data if available
                    if (cached) {
                        setLiveStreams(cached.data);
                    }
                }
            } finally {
                ongoingCallsRef.current.getLiveNow = false;
            }
        } catch (error) {
            console.error('Error loading live streams:', error);
            // Use cached data if available on error
            const cached = apiCacheRef.current.liveNow;
            if (cached) {
                setLiveStreams(cached.data);
            } else {
                showToast(`Failed to load livestreams. ${error.message || 'Please try again later.'}`, 'error');
            }
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    // Check stream status realtime function
    const checkStreamStatus = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            // Check cache first
            const cached = apiCacheRef.current.liveNow;
            if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
                // Use cached data if still fresh
                const newStreams = cached.data;
                setLiveStreams(prev => {
                    if (JSON.stringify(prev) !== JSON.stringify(newStreams)) {
                        return newStreams;
                    }
                    return prev;
                });
                return;
            }

            // Prevent duplicate calls
            if (ongoingCallsRef.current.checkStatus) {
                return;
            }
            ongoingCallsRef.current.checkStatus = true;

            try {
                const response = await Api.livestream.getLiveNow(token);

                if (response.data?.success) {
                    // Backend may return: { success: true, data: { livestream: {...} } } or { livestreams: [...] }
                    let newStreams = [];

                    if (response.data?.data?.livestreams && Array.isArray(response.data.data.livestreams)) {
                        // Array format - filter only live streams
                        newStreams = response.data.data.livestreams.filter(s => s && s.status === 'live');
                    } else if (response.data?.data?.livestream) {
                        // Single object format - convert to array
                        const livestream = response.data.data.livestream;
                        if (livestream && livestream.status === 'live') {
                            newStreams = [livestream];
                        }
                    }

                    // Cache the result
                    apiCacheRef.current.liveNow = {
                        data: newStreams,
                        timestamp: Date.now()
                    };

                    // Only update if different (optimize re-renders)
                    setLiveStreams(prev => {
                        const prevStr = JSON.stringify(prev.map(s => s._id).sort());
                        const newStr = JSON.stringify(newStreams.map(s => s._id).sort());
                        if (prevStr !== newStr) {
                            return newStreams;
                        }
                        return prev;
                    });
                }
            } finally {
                ongoingCallsRef.current.checkStatus = false;
            }
        } catch (error) {
            console.error('Error checking stream status:', error);
            const cached = apiCacheRef.current.liveNow;
            if (cached) {
                setLiveStreams(cached.data);
            }
        }
    }, []);

    // Just navigate to detail page
    const handleStreamClick = (streamId) => {
        navigate(`/live/${streamId}`);
    };

    // Load live streams on component mount
    useEffect(() => {
        loadLiveStreams();
    }, [loadLiveStreams]);

    // Set up realtime status checking
    useEffect(() => {
        const statusCheckInterval = setInterval(() => {
            checkStreamStatus();
        }, 5000); // Check every 5 seconds

        return () => clearInterval(statusCheckInterval);
    }, [checkStreamStatus]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black">
            {/* Header */}
            <div className="bg-black/80 backdrop-blur-md border-b border-gray-800/50 shadow-lg sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-20">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <div className="w-12 h-12 bg-gradient-to-br from-red-600 to-pink-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/50">
                                    <LiveTv className="w-7 h-7 text-white" />
                                </div>
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping"></div>
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
                                    Live Streams
                                </h1>
                                <p className="text-gray-400 text-sm">Watch live now</p>
                            </div>
                            <div className="flex items-center gap-2 bg-green-500/20 backdrop-blur-sm px-3 py-1.5 rounded-full border border-green-500/30">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                <span className="text-sm text-green-400 font-medium">Realtime</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {isLoading ? (
                    <div className="text-center py-16">
                        <div className="relative inline-block mb-4">
                            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-800"></div>
                            <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-red-500 absolute top-0 left-0"></div>
                        </div>
                        <p className="text-gray-300 text-lg font-medium">Loading streams...</p>
                        <p className="text-gray-500 text-sm mt-2">Please wait a moment</p>
                    </div>
                ) : liveStreams.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {liveStreams.map((stream, index) => (
                            <div
                                key={index}
                                className="relative bg-gradient-to-br from-gray-900/90 to-black/90 backdrop-blur-sm rounded-3xl overflow-hidden cursor-pointer group border border-gray-800/50 shadow-2xl hover:shadow-red-500/20 transition-all duration-500 hover:scale-[1.02] hover:border-red-500/50"
                                style={{ aspectRatio: '9/16' }}
                                onClick={() => handleStreamClick(stream._id)}
                            >
                                {/* Video Preview Placeholder */}
                                <div className="absolute inset-0 bg-gradient-to-br from-purple-900/80 via-blue-900/80 to-indigo-900/80 flex items-center justify-center">
                                    <div className="text-center text-white">
                                        <div className="relative mb-6">
                                            <div className="w-20 h-20 bg-gradient-to-br from-red-600 to-pink-600 rounded-full flex items-center justify-center mx-auto shadow-xl shadow-red-500/50 animate-pulse">
                                                <LiveTv className="w-10 h-10" />
                                            </div>
                                            <div className="absolute inset-0 bg-red-500/30 rounded-full animate-ping"></div>
                                        </div>
                                        <div className="text-xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">LIVE</div>
                                    </div>
                                </div>

                                {/* Stream Info Overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent">
                                    <div className="absolute top-5 left-5 right-5">
                                        <div className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-pink-600 text-white px-4 py-1.5 rounded-full text-xs font-bold backdrop-blur-sm border border-red-500/50 shadow-lg">
                                            <div className="w-2 h-2 bg-white rounded-full animate-ping"></div>
                                            <span>LIVE</span>
                                        </div>
                                    </div>

                                    <div className="absolute bottom-5 left-5 right-5">
                                        <h3 className="text-white font-bold text-xl mb-2 truncate drop-shadow-lg">
                                            {stream.title || 'Untitled Stream'}
                                        </h3>
                                        <p className="text-gray-300 text-sm truncate mb-3">
                                            {stream.description || 'No description'}
                                        </p>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/10">
                                                    <span className="text-white text-sm font-semibold">👤 {stream.currentViewers || 0}</span>
                                                </div>
                                                {stream.peakViewers > 0 && (
                                                    <div className="flex items-center gap-1 bg-yellow-500/20 backdrop-blur-sm px-2 py-1 rounded-full border border-yellow-500/30">
                                                        <span className="text-yellow-400 text-xs font-medium">⭐ Peak: {stream.peakViewers}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-2 text-xs text-gray-400 truncate">
                                            Host: {stream.hostId?.name || stream.hostId?._id || 'Unknown'}
                                        </div>
                                    </div>
                                </div>

                                {/* Hover Effect */}
                                <div className="absolute inset-0 bg-gradient-to-br from-red-600/20 to-pink-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center backdrop-blur-sm">
                                    <div className="bg-gradient-to-r from-red-600 to-pink-600 text-white px-8 py-4 rounded-2xl font-bold text-lg shadow-2xl shadow-red-500/50 transform group-hover:scale-110 transition-transform duration-300 border border-white/20">
                                        👆 Tap to watch
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-24">
                        <div className="relative inline-block mb-8">
                            <div className="w-32 h-32 bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-full flex items-center justify-center mx-auto backdrop-blur-sm border border-gray-700/50">
                                <LiveTv className="w-16 h-16 text-gray-600" />
                            </div>
                            <div className="absolute inset-0 bg-gray-600/20 rounded-full animate-ping"></div>
                        </div>
                        <h3 className="text-3xl font-bold mb-4 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                            No streams are currently live
                        </h3>
                        <p className="text-gray-400 text-lg mb-2">Please come back later to watch new streams!</p>
                        <p className="text-gray-500 text-sm">Check back soon for exciting live content</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveStream;
