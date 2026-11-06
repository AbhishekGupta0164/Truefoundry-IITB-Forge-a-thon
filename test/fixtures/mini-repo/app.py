def calculate_total(prices, tax_rate=0.05):
    """Calculates total price including tax."""
    return sum(prices) * (1 + tax_rate)
