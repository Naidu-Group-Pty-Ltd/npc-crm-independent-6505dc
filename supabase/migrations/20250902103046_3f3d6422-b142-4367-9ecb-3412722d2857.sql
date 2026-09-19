-- Insert comprehensive chart configurations for all available chart types

-- Advanced Analytics Cards (not traditional charts but metrics cards)
INSERT INTO chart_configurations (template_name, chart_type, quickchart_config, default_styling) VALUES
('advanced_analytics', 'bar', '{
  "type": "bar",
  "data": {
    "labels": ["Market Velocity", "Price Distribution", "Data Quality", "Market Coverage"],
    "datasets": [{
      "label": "Analytics",
      "data": [],
      "backgroundColor": ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"]
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Advanced Analytics Overview"
      },
      "legend": {
        "display": false
      }
    },
    "scales": {
      "y": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "Metric Values"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}');

-- Temporal Analysis Charts
INSERT INTO chart_configurations (template_name, chart_type, quickchart_config, default_styling) VALUES
('daily_listing_activity', 'line', '{
  "type": "line",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Daily Listings",
      "data": [],
      "borderColor": "#3b82f6",
      "backgroundColor": "rgba(59, 130, 246, 0.1)",
      "tension": 0.1,
      "fill": true
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Daily Listing Activity (Last 30 Days)"
      },
      "legend": {
        "display": true,
        "position": "top"
      }
    },
    "scales": {
      "y": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "Number of Listings"
        }
      },
      "x": {
        "title": {
          "display": true,
          "text": "Date"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}'),

('pricing_trends', 'line', '{
  "type": "line",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Average Price",
      "data": [],
      "borderColor": "#10b981",
      "backgroundColor": "rgba(16, 185, 129, 0.1)",
      "tension": 0.1,
      "fill": true
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Average Daily Pricing Trends"
      },
      "legend": {
        "display": true,
        "position": "top"
      }
    },
    "scales": {
      "y": {
        "beginAtZero": false,
        "title": {
          "display": true,
          "text": "Average Price ($)"
        }
      },
      "x": {
        "title": {
          "display": true,
          "text": "Date"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}'),

('data_confidence_trends', 'line', '{
  "type": "line",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Confidence Score",
      "data": [],
      "borderColor": "#f59e0b",
      "backgroundColor": "rgba(245, 158, 11, 0.1)",
      "tension": 0.1,
      "fill": true
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Daily Data Confidence Trends"
      },
      "legend": {
        "display": true,
        "position": "top"
      }
    },
    "scales": {
      "y": {
        "min": 0,
        "max": 100,
        "title": {
          "display": true,
          "text": "Confidence Score (%)"
        }
      },
      "x": {
        "title": {
          "display": true,
          "text": "Date"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}');

-- Geographic Analysis Charts
INSERT INTO chart_configurations (template_name, chart_type, quickchart_config, default_styling) VALUES
('suburb_volume_distribution', 'bar', '{
  "type": "bar",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Listings",
      "data": [],
      "backgroundColor": "#3b82f6"
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Suburb Volume Distribution"
      },
      "legend": {
        "display": false
      }
    },
    "scales": {
      "y": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "Number of Listings"
        }
      },
      "x": {
        "title": {
          "display": true,
          "text": "Suburb"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}'),

('price_vs_volume_analysis', 'scatter', '{
  "type": "scatter",
  "data": {
    "datasets": [{
      "label": "Suburbs",
      "data": [],
      "backgroundColor": "#10b981",
      "borderColor": "#10b981"
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Price vs Volume Analysis"
      },
      "legend": {
        "display": true,
        "position": "top"
      }
    },
    "scales": {
      "y": {
        "beginAtZero": false,
        "title": {
          "display": true,
          "text": "Average Price ($)"
        }
      },
      "x": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "Number of Listings"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}');

-- Agent Performance Charts
INSERT INTO chart_configurations (template_name, chart_type, quickchart_config, default_styling) VALUES
('agent_listing_volume', 'bar', '{
  "type": "bar",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Listings",
      "data": [],
      "backgroundColor": "#8b5cf6"
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Agent Listing Volume"
      },
      "legend": {
        "display": false
      }
    },
    "scales": {
      "y": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "Number of Listings"
        }
      },
      "x": {
        "title": {
          "display": true,
          "text": "Agent"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}'),

('agency_distribution', 'bar', '{
  "type": "bar",
  "data": {
    "labels": [],
    "datasets": [{
      "label": "Active Agents",
      "data": [],
      "backgroundColor": "#06b6d4"
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Agency Size Distribution"
      },
      "legend": {
        "display": false
      }
    },
    "scales": {
      "y": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "Number of Active Agents"
        }
      },
      "x": {
        "title": {
          "display": true,
          "text": "Agency"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}');

-- Executive Insights (text-based insights, not traditional charts)
INSERT INTO chart_configurations (template_name, chart_type, quickchart_config, default_styling) VALUES
('executive_insights', 'bar', '{
  "type": "bar",
  "data": {
    "labels": ["Insights Generated", "Key Trends", "Action Items", "Opportunities"],
    "datasets": [{
      "label": "Executive Summary",
      "data": [],
      "backgroundColor": ["#ef4444", "#f59e0b", "#10b981", "#3b82f6"]
    }]
  },
  "options": {
    "responsive": true,
    "plugins": {
      "title": {
        "display": true,
        "text": "Executive Insights Overview"
      },
      "legend": {
        "display": false
      }
    },
    "scales": {
      "y": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "Count"
        }
      }
    }
  }
}', '{"width": 800, "height": 400}');