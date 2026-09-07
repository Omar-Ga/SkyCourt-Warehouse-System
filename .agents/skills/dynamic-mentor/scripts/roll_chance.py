import random
import sys

def main():
    # 30% chance to return 1 (trigger pop-quiz), 70% chance to return 0 (skip)
    if random.random() < 0.30:
        print("1")
    else:
        print("0")

if __name__ == "__main__":
    main()
