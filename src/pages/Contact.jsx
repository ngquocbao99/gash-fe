// src/pages/Contact.jsx
import React, { useState, useCallback } from "react";
import { Mail, Phone, MapPin, Send } from "lucide-react";
import ProductButton from "../components/ProductButton";

const Contact = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });
  const [error, setError] = useState("");

  const handleInputChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      const { name, email, phone, message } = formData;

      // Validation
      if (!name.trim()) {
        setError("Please fill in all required fields");
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setError("Please enter a valid email address.");
        return;
      }
      if (phone && !/^\d{10}$/.test(phone)) {
        setError("Phone number must be 10 digits.");
        return;
      }
      if (!message.trim()) {
        setError("Please fill in all required fields");
        return;
      }
      const trimmedMessage = message.trim();
      if (trimmedMessage.length < 5 || trimmedMessage.length > 500) {
        setError("Message must be between 5 and 500 characters");
        return;
      }

      setError("");
      alert("Message sent successfully");

      setFormData({ name: "", email: "", phone: "", message: "" });
    },
    [formData]
  );

  return (
    <div className="flex flex-col items-center w-full max-w-7xl mx-auto my-3 sm:my-4 md:my-5 p-3 sm:p-4 md:p-5 lg:p-6 text-gray-900">
      {/* Header */}
      <header className="text-center mb-6 sm:mb-8 md:mb-10 w-full">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-2">
          Get in Touch
        </h1>
        <div className="w-20 h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 rounded mx-auto mb-5"></div>
        <p className="text-base sm:text-lg text-gray-600 max-w-2xl mx-auto">
          We'd love to hear from you. Whether you have a question, feedback, or a business inquiry —
          feel free to contact us anytime.
        </p>
      </header>

      {/* Content */}
      <section className="bg-white rounded-xl p-4 sm:p-5 md:p-6 lg:p-10 w-full shadow-sm border border-gray-200">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6 sm:gap-8 md:gap-10">
          {/* Left: Info */}
          <aside className="flex flex-col justify-between">
            <div>
              <div className="flex items-center mb-5">
                <div className="bg-amber-400 rounded-full p-2.5 mr-4 flex-shrink-0">
                  <Mail size={22} color="white" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 m-0">Email</h3>
                  <p className="text-sm text-gray-600 m-0">fptuniversityct@gmail.com</p>
                </div>
              </div>

              <div className="flex items-center mb-5">
                <div className="bg-amber-400 rounded-full p-2.5 mr-4 flex-shrink-0">
                  <Phone size={22} color="white" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 m-0">Phone</h3>
                  <p className="text-sm text-gray-600 m-0">0292 730 1866</p>
                </div>
              </div>

              <div className="flex items-center">
                <div className="bg-amber-400 rounded-full p-2.5 mr-4 flex-shrink-0">
                  <MapPin size={22} color="white" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 m-0">Address</h3>
                  <a
                    href="https://www.google.com/maps/place/FPT+University+Can+Tho,+Street+600+Nguyen+Van+Cu,+An+Binh+Ward,+Ninh+Kieu,+Can+Tho/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                  >
                    FPT University Can Tho, Street 600 Nguyen Van Cu, An Binh Ward,
                    Ninh Kieu District, Can Tho City
                  </a>
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="mt-6 sm:mt-8 rounded-xl overflow-hidden shadow-md">
              <iframe
                title="FPT University Can Tho Map"
                width="100%"
                height="250"
                className="border-0"
                loading="lazy"
                allowFullScreen
                src="https://www.google.com/maps?q=FPT+University+Can+Tho&output=embed"
              ></iframe>
            </div>
          </aside>

          {/* Right: Form */}
          <main>
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-2">
              Send Us a Message
            </h2>
            <div className="w-15 h-0.5 bg-amber-400 rounded mb-6"></div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="text-red-600 bg-red-50 border-2 border-red-200 rounded-xl p-3 sm:p-4 text-sm">
                  {error}
                </div>
              )}

              <input
                type="text"
                name="name"
                placeholder="Your Name"
                value={formData.name}
                onChange={handleInputChange}
                required
                className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              />

              <input
                type="email"
                name="email"
                placeholder="Your Email"
                value={formData.email}
                onChange={handleInputChange}
                required
                className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              />

              <input
                type="tel"
                name="phone"
                placeholder="Your Phone (optional)"
                value={formData.phone}
                onChange={handleInputChange}
                className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              />

              <textarea
                name="message"
                placeholder="Your Message"
                value={formData.message}
                onChange={handleInputChange}
                rows={6}
                required
                className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed resize-none"
              ></textarea>

              <ProductButton
                type="submit"
                variant="primary"
                size="lg"
                className="flex items-center justify-center gap-2"
              >
                <Send size={18} />
                Send Message
              </ProductButton>
            </form>
          </main>
        </div>
      </section>
    </div>
  );
};

export default Contact;
